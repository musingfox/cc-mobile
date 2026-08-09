/**
 * ws-transcript-page.test.ts — TranscriptPageEndpoint.
 *
 * Drives the real WS plugin over a real socket (ws-harness), so the Zod gate,
 * the dispatch and the event-buffer discipline are the production ones. The
 * backend is a fake that owns the same two-step the herdr backend owns —
 * resolve the pane's transcript path, then read a page from exactly that path —
 * so what is under test here is the wire contract, not the daemon.
 *
 * The retired history-request name is assembled from fragments where it has to
 * be sent, like every other file that mentions one: `dead-code-residue.test.ts`
 * scans this directory and excludes only itself and
 * `protocol-retired-messages.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptDelivery } from "../transcript/delivery";
import { readTranscriptPage } from "../transcript/page";
import { startWsHarness, type WsHarness } from "./ws-harness";

let dir: string;
let harness: WsHarness | null = null;

function assistantRecord(uuid: string, text: string) {
  return { uuid, type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}

async function writeTranscript(name: string, records: unknown[]): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return path;
}

/**
 * A backend that knows where each session's transcript lives and reads a page
 * from that path and no other — the same shape as the herdr backend's method.
 * `paths` doubles as the listing: a session id that is not a key is one the
 * backend does not list, and a key mapped to null is a session whose path does
 * not resolve (the C20 null-agent_session transition).
 */
function pagingBackend(paths: Record<string, string | null>) {
  const read: string[] = [];
  return {
    read,
    backend: {
      readTranscriptPage: async (sessionId: string, before: never) => {
        const path = paths[sessionId];
        if (!path) return null;
        read.push(path);
        return readTranscriptPage({ path, before });
      },
    },
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ws-page-"));
});

afterEach(async () => {
  await harness?.close();
  harness = null;
  await rm(dir, { recursive: true, force: true });
});

describe("TranscriptPageEndpoint", () => {
  it("T1: given a request for a listed session -> expect one transcript_page with 7 records oldest→newest, nextBefore null, non-empty epoch", async () => {
    const path = await writeTranscript(
      "s.jsonl",
      Array.from({ length: 7 }, (_, i) => assistantRecord(`u${i + 1}`, `t${i + 1}`)),
    );
    harness = await startWsHarness(pagingBackend({ "pane-1": path }).backend);

    harness.send({ type: "transcript_page_request", sessionId: "pane-1" });
    const reply = await harness.waitFor((m) => m.type === "transcript_page");

    expect(reply.sessionId).toBe("pane-1");
    expect((reply.records as { recordId: string }[]).map((r) => r.recordId)).toEqual([
      "u1",
      "u2",
      "u3",
      "u4",
      "u5",
      "u6",
      "u7",
    ]);
    expect(reply.nextBefore).toBeNull();
    expect(reply.epoch).toMatch(/^[0-9a-f]{16}$/);
  });

  it("T2: given a session the backend does not list -> expect transcript_unavailable naming that session", async () => {
    const path = await writeTranscript("s.jsonl", [assistantRecord("u1", "hi")]);
    harness = await startWsHarness(pagingBackend({ "pane-1": path }).backend);

    harness.send({ type: "transcript_page_request", sessionId: "nope" });
    const reply = await harness.waitFor((m) => m.type === "error");

    expect(reply.code).toBe("transcript_unavailable");
    expect(reply.sessionId).toBe("nope");
    expect(harness.received.some((m) => m.type === "transcript_page")).toBe(false);
  });

  it("T3: given a session whose path does not resolve -> expect transcript_unavailable, never a page with a placeholder epoch", async () => {
    harness = await startWsHarness(pagingBackend({ "pane-1": null }).backend);

    harness.send({ type: "transcript_page_request", sessionId: "pane-1" });
    const reply = await harness.waitFor((m) => m.type === "error");

    expect(reply.code).toBe("transcript_unavailable");
    expect(harness.received.some((m) => m.type === "transcript_page")).toBe(false);
  });

  it("T4: given a request with no sessionId -> expect invalid_message and the socket stays open", async () => {
    const path = await writeTranscript("s.jsonl", [assistantRecord("u1", "hi")]);
    harness = await startWsHarness(pagingBackend({ "pane-1": path }).backend);

    harness.send({ type: "transcript_page_request" });
    const refusal = await harness.waitFor((m) => m.type === "error");
    expect(refusal.code).toBe("invalid_message");

    // Still open: the next well-formed request is answered on the same socket.
    harness.send({ type: "transcript_page_request", sessionId: "pane-1" });
    const reply = await harness.waitFor((m) => m.type === "transcript_page");
    expect(reply.sessionId).toBe("pane-1");
  });

  it("T5: given the retired history request name -> expect invalid_message; the retired name stays refused", async () => {
    harness = await startWsHarness(pagingBackend({}).backend);

    harness.send({ type: `session${"_"}history`, sessionId: "x" });
    const reply = await harness.waitFor((m) => m.type === "error");

    expect(reply.code).toBe("invalid_message");
    expect(harness.received.some((m) => m.type === "transcript_page")).toBe(false);
  });

  it("T7: given a session with buffered events -> expect the page is not wrapped in an event envelope and is absent from the replay buffer", async () => {
    const path = await writeTranscript("s.jsonl", [assistantRecord("u1", "hi")]);
    harness = await startWsHarness(pagingBackend({ "pane-1": path }).backend);
    harness.eventBuffer.append("pane-1", { type: "stream_chunk", sessionId: "pane-1", chunk: {} });

    harness.send({ type: "transcript_page_request", sessionId: "pane-1" });
    await harness.waitFor((m) => m.type === "transcript_page");

    expect(harness.received.some((m) => m.type === "event")).toBe(false);
    const buffered = harness.eventBuffer.replay("pane-1", 0).map((e) => e.message.type);
    expect(buffered).not.toContain("transcript_page");
    expect(buffered).toEqual(["stream_chunk"]);
  });

  it("T8: given an omp session whose transcript key is a path -> expect exactly that file is read, with no directory scan reaching a nested sub-agent transcript", async () => {
    const path = await writeTranscript("omp-session.jsonl", [assistantRecord("o1", "mine")]);
    // A sub-agent transcript sitting in the same directory. A pager that
    // scanned the directory instead of reading the named path would pick it up.
    await writeTranscript("__advisor.jsonl", [assistantRecord("adv1", "not mine")]);
    const paging = pagingBackend({ "pane-omp": path });
    harness = await startWsHarness(paging.backend);

    harness.send({ type: "transcript_page_request", sessionId: "pane-omp" });
    const reply = await harness.waitFor((m) => m.type === "transcript_page");

    expect(paging.read).toEqual([path]);
    expect((reply.records as { recordId: string }[]).map((r) => r.recordId)).toEqual(["o1"]);
  });

  it("T9: given a live delivery and a page request for the same session and path -> expect the epochs agree", async () => {
    const path = await writeTranscript("s.jsonl", [assistantRecord("u1", "hi")]);
    harness = await startWsHarness(pagingBackend({ "pane-1": path }).backend);

    const delivered: Record<string, unknown>[] = [];
    const delivery = createTranscriptDelivery({
      resolvePath: async () => path,
      getSink: () => (msg) => delivered.push(msg),
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });
    await delivery.deliverTurn("pane-1");

    harness.send({ type: "transcript_page_request", sessionId: "pane-1" });
    const reply = await harness.waitFor((m) => m.type === "transcript_page");

    const chunk = delivered.find((m) => m.type === "stream_chunk")?.chunk as { epoch?: string };
    expect(chunk?.epoch).toMatch(/^[0-9a-f]{16}$/);
    expect(chunk?.epoch).toBe(reply.epoch as string);
  });
});
