import { expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { createApp } from "../app";
import type { ServerConfig } from "../config";
import { createHerdrClient } from "../herdr/client";
import { OkResultSchema, PaneProcessInfoResultSchema } from "../herdr/schema";
import { resolveSocketPath } from "../herdr/transport";

// Live E2E for issue #24's Done criterion — the EX-11 three judgements against a
// real herdr-backed claude, fully program-driven (no human at the phone):
//
//   J1  a gated tool raises permission_request on the WS (the sheet would pop)
//   J2  replying allow:true lets the tool run — its output comes back in the stream
//   J3  replying allow:false blocks it — the filesystem canary never appears
//
// Plus two receipts riding the same run:
//   argv                     the pane's claude runs --permission-mode default
//   StopHookReadbackNoRegress both turns still deliver stream_chunk + stream_end
//
// Runs only against a real daemon (skipIf socket missing) and burns two real
// claude turns. cwd = this repo's root, a trusted directory (probe: readiness
// 3034ms, no trust dialog under default mode).

const socketPath = resolveSocketPath();

/** Repo root resolved from this file — the trusted cwd the session runs in. */
const REPO_ROOT = join(import.meta.dir, "..", "..");

const CREATE_DEADLINE_MS = 45_000;
const TURN_DEADLINE_MS = 120_000;
const TEST_TIMEOUT_MS = 400_000;

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
  if (port === undefined) throw new Error("could not reserve an ephemeral port");
  return port;
}

type ServerMsg = Record<string, unknown>;

/**
 * Ordered consumer over the raw WebSocket, flattening the buffered
 * `{type:"event", payload}` envelope. `next` consumes in arrival order,
 * discarding non-matches, and fails with the step label on deadline.
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

/**
 * Auto-replies to EVERY permission_request as it arrives, independent of the
 * collector's cursor. The deny turn needs this: a second request raised while
 * the test awaits stream_end would otherwise sit unanswered until the relay's
 * 90s timeout-deny and blow the turn deadline.
 */
function autoReply(ws: WebSocket, allow: boolean) {
  const seen: ServerMsg[] = [];
  const listener = (event: Event) => {
    const raw = JSON.parse(String((event as MessageEvent).data)) as ServerMsg;
    const msg = raw.type === "event" ? (raw.payload as ServerMsg) : raw;
    if (msg.type !== "permission_request") return;
    seen.push(msg);
    ws.send(JSON.stringify({ type: "permission", requestId: msg.requestId, allow }));
  };
  ws.addEventListener("message", listener);
  return { seen, stop: () => ws.removeEventListener("message", listener) };
}

function chunkText(msg: ServerMsg): string {
  const chunk = msg.chunk as
    | { message?: { content?: Array<{ type?: string; text?: string }> } }
    | undefined;
  const content = chunk?.message?.content;
  return Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : "";
}

it.skipIf(!existsSync(socketPath))(
  "live herdr permission gate E2E: request -> allow runs -> deny blocks (EX-11)",
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

    // Canaries: the allow turn proves execution by echoing one, the deny turn
    // proves non-execution by the other never reaching the filesystem.
    const allowCanary = `ccm-e2e-allow-${uuid8}`;
    const denyCanaryPath = join("/tmp", `ccm-e2e-deny-${uuid8}`);

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

      // Step 1: create the session in the trusted repo root.
      const t1 = Date.now();
      ws.send(JSON.stringify({ type: "terminal_create", claudeUuid, cwd: REPO_ROOT }));
      const created = await collector.next(
        (msg) => msg.type === "terminal_created" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "step 1 terminal_created",
      );
      expect(created.type).toBe("terminal_created");
      const paneRef = created.paneRef as string;
      expect(typeof paneRef).toBe("string");
      console.log(`[e2e] step 1 terminal_created paneRef=${paneRef} in ${Date.now() - t1}ms`);

      const panesBefore = await client.call("pane.list", {}, PaneListResultSchema);
      workspaceId = panesBefore.panes.find((pane) => pane.pane_id === paneRef)?.workspace_id;
      expect(workspaceId).toBeDefined();

      // Receipt: the claude in that pane runs under --permission-mode default
      // (HerdrLaunchPermissionMode's end-to-end observable). Without it the gate
      // below would be bypassed and every judgement would pass for the wrong reason.
      const info = await client.call(
        "pane.process_info",
        { pane_id: paneRef },
        PaneProcessInfoResultSchema,
      );
      const claudeProc = (info.process_info.foreground_processes ?? []).find((proc) => {
        const names = [proc.argv0, proc.argv?.[0]];
        return names.some((name) => typeof name === "string" && basename(name) === "claude");
      });
      expect(claudeProc).toBeDefined();
      const argv = claudeProc?.argv ?? [];
      const modeIdx = argv.indexOf("--permission-mode");
      expect(modeIdx).toBeGreaterThanOrEqual(0);
      expect(argv[modeIdx + 1]).toBe("default");
      console.log(`[e2e] argv receipt: --permission-mode ${argv[modeIdx + 1]}`);

      // ── Turn 1: allow ──────────────────────────────────────────────────────
      // J1: the gated Bash raises a permission_request (the sheet would pop).
      // J2: after allow:true the tool actually runs — its echo lands in the stream.
      const t2 = Date.now();
      ws.send(
        JSON.stringify({
          type: "terminal_send",
          claudeUuid,
          content: `Run this bash command and show me its output: echo ${allowCanary}`,
        }),
      );

      const request = await collector.next(
        (msg) => msg.type === "permission_request",
        TURN_DEADLINE_MS,
        "J1 permission_request",
      );
      expect((request.tool as { name?: string }).name).toBe("Bash");
      expect(String(request.requestId)).toStartWith("toolu_");
      expect(request.sessionId).toBe(claudeUuid);
      console.log(`[e2e] J1 permission_request ${request.requestId} in ${Date.now() - t2}ms`);

      // Answer this one, and auto-answer any follow-up in the same turn.
      const allowResponder = autoReply(ws, true);
      ws.send(JSON.stringify({ type: "permission", requestId: request.requestId, allow: true }));

      const reply1 = await collector.next(
        (msg) =>
          (msg.type === "stream_chunk" || msg.type === "error") && msg.sessionId === claudeUuid,
        TURN_DEADLINE_MS,
        "J2 stream_chunk",
      );
      expect(reply1.type).toBe("stream_chunk");
      // StopHookReadbackNoRegress: the Stop hook still delivers the assistant
      // reply now that a PreToolUse hook shares the same --settings file.
      expect((reply1.chunk as { type?: string }).type).toBe("assistant");
      expect(chunkText(reply1)).toContain(allowCanary);
      const end1 = await collector.next(
        (msg) => msg.type === "stream_end" && msg.sessionId === claudeUuid,
        TURN_DEADLINE_MS,
        "J2 stream_end",
      );
      expect(end1.sessionId).toBe(claudeUuid);
      allowResponder.stop();
      console.log(`[e2e] J2 allow turn done in ${Date.now() - t2}ms`);

      // ── Turn 2: deny ───────────────────────────────────────────────────────
      // J3: every permission_request in this turn is denied, so the canary file
      // must never exist. The responder is armed BEFORE the prompt so a retry
      // raised while awaiting stream_end is answered immediately rather than
      // waiting out the relay's 90s timeout.
      const t3 = Date.now();
      expect(existsSync(denyCanaryPath)).toBe(false);
      const denyResponder = autoReply(ws, false);
      ws.send(
        JSON.stringify({
          type: "terminal_send",
          claudeUuid,
          content: `Run this bash command: touch ${denyCanaryPath}`,
        }),
      );

      const reply2 = await collector.next(
        (msg) =>
          (msg.type === "stream_chunk" || msg.type === "error") && msg.sessionId === claudeUuid,
        TURN_DEADLINE_MS,
        "J3 stream_chunk",
      );
      expect(reply2.type).toBe("stream_chunk");
      // StopHookReadbackNoRegress: a blocked turn still closes normally — the
      // spinner does not hang on the phone.
      expect((reply2.chunk as { type?: string }).type).toBe("assistant");
      const end2 = await collector.next(
        (msg) => msg.type === "stream_end" && msg.sessionId === claudeUuid,
        TURN_DEADLINE_MS,
        "J3 stream_end",
      );
      expect(end2.sessionId).toBe(claudeUuid);
      denyResponder.stop();

      // At least one request was raised and denied — an empty responder would
      // make the canary assertion below vacuous.
      expect(denyResponder.seen.length).toBeGreaterThan(0);
      // The receipt of deny itself: the tool never ran.
      expect(existsSync(denyCanaryPath)).toBe(false);
      console.log(
        `[e2e] J3 deny turn done in ${Date.now() - t3}ms (${denyResponder.seen.length} denied)`,
      );

      // Step 4: teardown leaves no pane behind.
      ws.send(JSON.stringify({ type: "terminal_teardown", claudeUuid }));
      const teardownResult = await collector.next(
        (msg) => msg.type === "terminal_teardown_result" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "step 4 terminal_teardown_result",
      );
      expect(teardownResult.type).toBe("terminal_teardown_result");
      expect(teardownResult.killed).toBe(true);
      tornDown = true;
    } finally {
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
      // The canary must not survive the run even if a deny leaked through.
      try {
        rmSync(denyCanaryPath, { force: true });
      } catch {
        // nothing to remove
      }
      // force-close: default stop() awaits lingering keep-alive connections.
      await app.stop(true);
    }
  },
  TEST_TIMEOUT_MS,
);
