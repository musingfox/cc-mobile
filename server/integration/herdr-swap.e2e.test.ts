import { expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createApp } from "../app";
import type { ServerConfig } from "../config";
import { createHerdrClient } from "../herdr/client";
import { OkResultSchema } from "../herdr/schema";
import { resolveSocketPath } from "../herdr/transport";

// Live E2E for issue #22's Done criterion — the mobile protocol drives a real
// herdr-backed claude session end to end: create -> prompt -> reply ->
// desktop-attach identity -> second turn -> teardown. This is the sequence the
// the deleted PTY one-shot path could not do (multi-turn on one live session).
//
// Updated for #29: the session key on the wire is herdr's pane id, not the uuid
// the client minted for the create request, and the replies below are read out
// of claude's transcript rather than delivered by a Stop hook.
//
// Runs only against a real daemon (skipIf socket missing) and burns two real
// claude turns with minimal prompts. cwd = this repo's root, which must be a
// trusted directory per plan D5 (trust-dialog handling is deferred to #24).

const socketPath = resolveSocketPath();

// Repo root resolved from this file — the trusted cwd the session runs in.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const CREATE_DEADLINE_MS = 45_000;
const TURN_DEADLINE_MS = 120_000;
const TEST_TIMEOUT_MS = 300_000;

const PROMPT_TURN_1 = "Reply with exactly PONG and nothing else.\nDo not add punctuation.";
const PROMPT_TURN_1_FRAGMENT = "punctuation";
const PROMPT_TURN_2 = "Reply with exactly PONG2";

const PaneListResultSchema = z
  .object({
    panes: z.array(z.object({ pane_id: z.string(), workspace_id: z.string() }).passthrough()),
  })
  .passthrough();

/** Reserves a free port so createApp's loopback hook URLs carry a real number. */
function reserveEphemeralPort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  return port;
}

type ServerMsg = Record<string, unknown>;

/**
 * Ordered consumer over the raw WebSocket. Buffered replies arrive wrapped in
 * the `{type:"event", eventId, sessionId, payload}` envelope; control replies
 * (terminal_created, terminal_teardown_result, error) arrive raw — both are flattened
 * to their payload. `next` consumes messages in arrival order, discarding
 * non-matches (e.g. auxiliary session_state events), and fails with the step
 * label on deadline.
 */
function createMessageCollector(ws: WebSocket) {
  const messages: ServerMsg[] = [];
  let cursor = 0;
  let waiters: Array<() => void> = [];

  ws.addEventListener("message", (event) => {
    const raw = JSON.parse(String((event as MessageEvent).data)) as ServerMsg;
    const payload = raw.type === "event" ? (raw.payload as ServerMsg) : raw;
    messages.push(payload);
    const pending = waiters;
    waiters = [];
    for (const wake of pending) wake();
  });

  async function next(
    predicate: (msg: ServerMsg) => boolean,
    deadlineMs: number,
    label: string,
  ): Promise<ServerMsg> {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
      while (cursor < messages.length) {
        const msg = messages[cursor];
        cursor += 1;
        if (predicate(msg)) return msg;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`${label} not observed within ${deadlineMs}ms`);
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, Math.min(remaining, 1_000));
      });
    }
  }

  return { next };
}

function chunkText(msg: ServerMsg): string {
  const chunk = msg.chunk as
    | { message?: { content?: Array<{ type?: string; text?: string }> } }
    | undefined;
  const content = chunk?.message?.content;
  return Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : "";
}

it.skipIf(!existsSync(socketPath))(
  "live herdr swap E2E: mobile protocol create -> reply -> attach identity -> second turn -> teardown",
  async () => {
    const port = reserveEphemeralPort();
    const serverConfig: ServerConfig = {
      port,
      hostname: "127.0.0.1",
      defaultCwd: null,
      permissionMode: "default",
      allowedRoots: null,
      basePath: "",
    };
    const app = createApp(serverConfig);
    app.listen({ port, hostname: "127.0.0.1" });

    const client = createHerdrClient({ socketPath });
    const claudeUuid = crypto.randomUUID();
    const uuid8 = claudeUuid.slice(0, 8);

    let ws: WebSocket | undefined;
    let workspaceId: string | undefined;
    let tornDown = false;

    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const collector = createMessageCollector(ws);
      const socket = ws;
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve());
        socket.addEventListener("error", () => reject(new Error("ws connection failed")));
      });

      // Step 1: terminal_create -> terminal_created with a paneRef (readiness-gated).
      const t1 = Date.now();
      ws.send(JSON.stringify({ type: "terminal_create", claudeUuid, cwd: REPO_ROOT }));
      const created = await collector.next(
        (msg) => msg.type === "terminal_created" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "step 1 terminal_created",
      );
      expect(created.type).toBe("terminal_created");
      expect(created.claudeUuid).toBe(claudeUuid);
      const paneRef = created.paneRef as string;
      expect(typeof paneRef).toBe("string");
      expect(paneRef.length).toBeGreaterThan(0);
      // The wire session key from here on (Decision H5); the request uuid only
      // named the buffer slot this ack landed in.
      const sessionId = created.sessionId as string;
      expect(sessionId).toBe(paneRef);
      console.log(`[e2e] step 1 terminal_created paneRef=${paneRef} in ${Date.now() - t1}ms`);

      // Record the workspace for the post-teardown assertion + finally cleanup.
      const panesBefore = await client.call("pane.list", {}, PaneListResultSchema);
      workspaceId = panesBefore.panes.find((pane) => pane.pane_id === paneRef)?.workspace_id;
      expect(workspaceId).toBeDefined();

      // Step 2: two-line prompt submits as ONE turn; the reply arrives as
      // stream_chunk(assistant) + stream_end, read from claude's transcript
      // when herdr reports the turn settled.
      const t2 = Date.now();
      ws.send(
        JSON.stringify({ type: "terminal_send", claudeUuid: sessionId, content: PROMPT_TURN_1 }),
      );
      const reply1 = await collector.next(
        (msg) =>
          (msg.type === "stream_chunk" || msg.type === "error") && msg.sessionId === sessionId,
        TURN_DEADLINE_MS,
        "step 2 stream_chunk",
      );
      expect(reply1.type).toBe("stream_chunk");
      expect((reply1.chunk as { type?: string }).type).toBe("assistant");
      expect(chunkText(reply1)).toContain("PONG");
      await collector.next(
        (msg) => msg.type === "stream_end" && msg.sessionId === sessionId,
        TURN_DEADLINE_MS,
        "step 2 stream_end",
      );
      console.log(`[e2e] step 2 turn 1 reply in ${Date.now() - t2}ms`);

      // Step 3: desktop-attach identity — the pane's agent carries the literal
      // `herdr agent attach ccm-<uuid8>` target, and the visible pane shows the
      // prompt (same live session observable from the desktop side).
      const t3 = Date.now();
      const agentInfo = await client.agentGet(paneRef);
      // AgentInfo.agent is the kind label ("claude"); the attach target is .name.
      expect(agentInfo.name).toBe(`ccm-${uuid8}`);
      const read = await client.paneRead({ pane_id: paneRef, source: "visible", strip_ansi: true });
      expect(read.text).toContain(PROMPT_TURN_1_FRAGMENT);
      console.log(`[e2e] step 3 attach identity ccm-${uuid8} in ${Date.now() - t3}ms`);

      // Step 4: second turn on the SAME session — multi-turn on one live pane.
      const t4 = Date.now();
      ws.send(
        JSON.stringify({ type: "terminal_send", claudeUuid: sessionId, content: PROMPT_TURN_2 }),
      );
      const reply2 = await collector.next(
        (msg) =>
          (msg.type === "stream_chunk" || msg.type === "error") && msg.sessionId === sessionId,
        TURN_DEADLINE_MS,
        "step 4 stream_chunk",
      );
      expect(reply2.type).toBe("stream_chunk");
      expect(chunkText(reply2)).toContain("PONG2");
      await collector.next(
        (msg) => msg.type === "stream_end" && msg.sessionId === sessionId,
        TURN_DEADLINE_MS,
        "step 4 stream_end",
      );
      console.log(`[e2e] step 4 turn 2 reply in ${Date.now() - t4}ms`);

      // Step 5: teardown kills the workspace and leaves no pane behind.
      const t5 = Date.now();
      ws.send(JSON.stringify({ type: "terminal_teardown", sessionId }));
      const teardownResult = await collector.next(
        (msg) => msg.type === "terminal_teardown_result" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "step 5 terminal_teardown_result",
      );
      expect(teardownResult.type).toBe("terminal_teardown_result");
      expect(teardownResult.killed).toBe(true);
      tornDown = true;
      const panesAfter = await client.call("pane.list", {}, PaneListResultSchema);
      expect(panesAfter.panes.some((pane) => pane.workspace_id === workspaceId)).toBe(false);
      console.log(`[e2e] step 5 teardown in ${Date.now() - t5}ms`);
    } finally {
      // Cleanup always runs: close the socket, then close the workspace
      // directly if the mobile-protocol teardown did not complete.
      try {
        ws?.close();
      } catch {
        // socket already gone
      }
      if (!tornDown && workspaceId !== undefined) {
        await client
          .call("workspace.close", { workspace_id: workspaceId }, OkResultSchema)
          .catch(() => {});
      }
      // force-close: default stop() awaits lingering keep-alive connections
      // (observed 300s hang after a full herdr lifecycle); production shutdown
      // is SIGTERM + process exit, so graceful drain is not what we verify here.
      await app.stop(true);
    }
  },
  TEST_TIMEOUT_MS,
);
