/**
 * ws-service-transcript-page.test.ts — the history pull as the transport sees
 * it: HistoryPageApplyIsolated, LocalOnlyDiscardOnFirstPage, the request-side
 * half of SessionOpenNewestPage, and the two contracts that say what a
 * `transcript_unavailable` reply must NOT do.
 *
 * Driven through `handleMessage`, i.e. from the assembly root: a test that
 * called the store action directly would prove the action works and say nothing
 * about whether anything feeds it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

function internals() {
  return wsService as unknown as {
    ws: unknown;
    handleMessage: (message: Record<string, unknown>) => void;
  };
}

let sent: Record<string, unknown>[] = [];
let previousWs: unknown;

function assistantRecord(recordId: string, seq: number, text = recordId) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    recordId,
    seq,
  };
}

function pageFrame(
  epoch: string,
  records: Record<string, unknown>[],
  nextBefore: unknown = null,
) {
  return { type: "transcript_page", sessionId: "s1", epoch, records, nextBefore };
}

function session() {
  const state = useAppStore.getState().sessions.get("s1");
  if (!state) throw new Error("no session s1");
  return state;
}

const pageRequests = () => sent.filter((m) => m.type === "transcript_page_request");

beforeEach(() => {
  previousWs = internals().ws;
  sent = [];
  internals().ws = { send: (raw: string) => sent.push(JSON.parse(raw)) };

  useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  useAppStore.getState().addSession("s1", "/cwd");
});

afterEach(() => {
  internals().ws = previousWs;

});

describe("HistoryPageApplyIsolated", () => {
  function midTurn() {
    const store = useAppStore.getState();
    store.setStreaming("s1", true);
    store.addActiveTool("s1", "t1", { toolName: "Read", startedAt: Date.now() });
    store.addActiveTool("s1", "t2", { toolName: "Bash", startedAt: Date.now() });
  }

  test("T1: a page arriving mid-turn disturbs neither the active tools nor the streaming flag", () => {
    midTurn();
    expect(session().activeTools.size).toBe(2);

    internals().handleMessage(
      pageFrame("aaaa", [assistantRecord("p1", 10), assistantRecord("p2", 20), assistantRecord("p3", 30)]),
    );

    expect(session().activeTools.size).toBe(2);
    expect(session().isStreaming).toBe(true);
  });

  test("T2: the same page still adds its three messages", () => {
    midTurn();
    internals().handleMessage(
      pageFrame("aaaa", [assistantRecord("p1", 10), assistantRecord("p2", 20), assistantRecord("p3", 30)]),
    );
    expect(session().messages).toHaveLength(3);
  });

  test("T3: a page for an idle session never starts a stream", () => {
    expect(session().isStreaming).toBe(false);
    const before = session().currentStreamMessageId;
    internals().handleMessage(pageFrame("aaaa", [assistantRecord("p1", 10)]));
    expect(session().isStreaming).toBe(false);
    expect(session().currentStreamMessageId).toBe(before);
  });

  test("T4: a page arriving while a permission is pending leaves the prompt up", () => {
    const pending = {
      requestId: "r1",
      tool: { name: "Bash", parameters: { text: "rm -rf /" } },
      options: [{ id: "1", label: "Yes" }],
    };
    useAppStore.getState().setPermission("s1", pending);
    internals().handleMessage(pageFrame("aaaa", [assistantRecord("p1", 10)]));
    expect(session().pendingPermission).toEqual(pending);
  });
});

describe("LocalOnlyDiscardOnFirstPage", () => {
  function restoreLocalOnly(count: number) {
    const store = useAppStore.getState();
    for (let i = 0; i < count; i++) {
      store.addMessage("s1", { id: `restored-${i}`, role: "user", content: `old ${i}`, timestamp: 1 });
    }
  }

  test("T1: three restored local-only messages give way to the page's two records", () => {
    restoreLocalOnly(3);
    wsService.requestTranscriptPage("s1");
    internals().handleMessage(pageFrame("aaaa", [assistantRecord("a", 10), assistantRecord("b", 20)]));
    expect(session().messages.map((m) => m.recordId)).toEqual(["a", "b"]);
  });

  test("T2: a message being sent right now survives while the restored one goes", () => {
    restoreLocalOnly(1);
    wsService.requestTranscriptPage("s1");
    wsService.terminalSend("s1", "typing");

    internals().handleMessage(pageFrame("aaaa", [assistantRecord("a", 10)]));

    const messages = session().messages;
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.content === "typing")).toBe(true);
    expect(messages.some((m) => m.id === "restored-0")).toBe(false);
  });

  test("T3: a transcript_unavailable reply discards nothing", () => {
    restoreLocalOnly(3);
    wsService.requestTranscriptPage("s1");
    internals().handleMessage({ type: "error", sessionId: "s1", code: "transcript_unavailable", message: "" });
    expect(session().messages).toHaveLength(3);
  });

  test("T4: a page for a session with no local-only messages changes nothing but the page", () => {
    wsService.requestTranscriptPage("s1");
    internals().handleMessage(pageFrame("aaaa", [assistantRecord("a", 10)]));
    expect(session().messages.map((m) => m.recordId)).toEqual(["a"]);
  });
});

describe("SessionOpenNewestPage — the request side", () => {
  test("T1: a newest-page request carries no `before`", () => {
    expect(wsService.requestTranscriptPage("s1")).toBe(true);
    expect(pageRequests()).toHaveLength(1);
    expect(pageRequests()[0]).toEqual({ type: "transcript_page_request", sessionId: "s1" });
    expect("before" in pageRequests()[0]).toBe(false);
  });

  test("T5: two activations before the reply arrives send exactly one request", () => {
    expect(wsService.requestTranscriptPage("s1")).toBe(true);
    expect(wsService.requestTranscriptPage("s1")).toBe(false);
    expect(pageRequests()).toHaveLength(1);
  });

  test("the guard clears on the reply, so re-opening fetches again", () => {
    wsService.requestTranscriptPage("s1");
    internals().handleMessage(pageFrame("aaaa", [assistantRecord("a", 10)]));
    expect(wsService.isTranscriptPageInFlight("s1")).toBe(false);
    expect(wsService.requestTranscriptPage("s1")).toBe(true);
    expect(pageRequests()).toHaveLength(2);
  });

  test("the guard clears on transcript_unavailable too, so a retry is possible", () => {
    wsService.requestTranscriptPage("s1");
    internals().handleMessage({ type: "error", sessionId: "s1", code: "transcript_unavailable", message: "" });
    expect(wsService.isTranscriptPageInFlight("s1")).toBe(false);
    expect(wsService.requestTranscriptPage("s1")).toBe(true);
  });

  test("T4: re-opening a session the terminal cleared holds only the new page", () => {
    wsService.requestTranscriptPage("s1");
    internals().handleMessage(pageFrame("aaaa", [assistantRecord("old1", 10), assistantRecord("old2", 20)]));
    expect(session().messages).toHaveLength(2);

    wsService.requestTranscriptPage("s1");
    internals().handleMessage(pageFrame("bbbb", [assistantRecord("new1", 0)]));

    expect(session().messages.map((m) => m.recordId)).toEqual(["new1"]);
    expect(session().epoch).toBe("bbbb");
  });

  test("a page carrying nextBefore stores it as the session's paging cursor", () => {
    const cursor = { epoch: "aaaa", seq: 400, recordId: "u9" };
    wsService.requestTranscriptPage("s1");
    internals().handleMessage(pageFrame("aaaa", [assistantRecord("a", 500)], cursor));
    expect(session().pagingCursor).toEqual(cursor);
  });

  test("a request with a cursor sends it as `before`", () => {
    const cursor = { epoch: "aaaa", seq: 400, recordId: "u9" };
    wsService.requestTranscriptPage("s1", cursor);
    expect(pageRequests()[0].before).toEqual(cursor);
  });
});

describe("TranscriptEpochAbsenceIgnored — the wire's half", () => {
  test("T7: transcript_unavailable leaves the messages and the epoch alone", () => {
    wsService.requestTranscriptPage("s1");
    internals().handleMessage(
      pageFrame("aaaa", [
        assistantRecord("a", 10),
        assistantRecord("b", 20),
        assistantRecord("c", 30),
        assistantRecord("d", 40),
      ]),
    );
    expect(session().messages).toHaveLength(4);

    internals().handleMessage({ type: "error", sessionId: "s1", code: "transcript_unavailable", message: "" });

    expect(session().messages).toHaveLength(4);
    expect(session().epoch).toBe("aaaa");
  });

  test("a transcript_unavailable reply raises no error bubble", () => {
    internals().handleMessage({ type: "error", sessionId: "s1", code: "transcript_unavailable", message: "" });
    expect(session().messages).toHaveLength(0);
  });
});

describe("TranscriptMessageUpsert — through the live dispatcher", () => {
  test("T3: five already-applied chunks replayed on reconnect add nothing", () => {
    const replay = [1, 2, 3, 4, 5].map((n) => ({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { ...assistantRecord(`u${n}`, n * 10), epoch: "aaaa" },
    }));
    for (const frame of replay) internals().handleMessage(frame);
    expect(session().messages).toHaveLength(5);

    for (const frame of replay) internals().handleMessage(frame);
    expect(session().messages).toHaveLength(5);
  });

  test("a page covering a turn already delivered live draws no second bubble", () => {
    internals().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { ...assistantRecord("u1", 10), epoch: "aaaa" },
    });
    wsService.requestTranscriptPage("s1");
    internals().handleMessage(pageFrame("aaaa", [assistantRecord("u1", 10)]));
    expect(session().messages).toHaveLength(1);
  });
});

describe("ChunkProjectsToTypedParts — same projection on both paths", () => {
  test("T12: page and live stream_chunk both project via projectChunk with blockIndex", () => {
    const mixed = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan" },
          { type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } },
          { type: "text", text: "answer" },
        ],
      },
      recordId: "same",
      seq: 42,
    };

    internals().handleMessage(pageFrame("aaaa", [mixed]));
    const fromPage = session().messages.map((m) => ({
      kind: m.kind,
      content: m.content,
      blockIndex: m.blockIndex,
      recordId: m.recordId,
      toolName: m.toolName,
    }));

    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/cwd");

    internals().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { ...mixed, epoch: "aaaa" },
    });
    const fromLive = session().messages.map((m) => ({
      kind: m.kind,
      content: m.content,
      blockIndex: m.blockIndex,
      recordId: m.recordId,
      toolName: m.toolName,
    }));

    expect(fromPage).toEqual(fromLive);
    expect(fromPage.map((m) => m.blockIndex)).toEqual([0, 1, 2]);
  });
});
