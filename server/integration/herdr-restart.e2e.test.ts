import { expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createHerdrClient } from "../herdr/client";
import { OkResultSchema } from "../herdr/schema";
import { resolveSocketPath } from "../herdr/transport";
import { waitUntil } from "./e2e-harness";

// Live E2E for issue #23's Done criterion — a real claude session survives a
// server kill + restart: create -> teach codeword -> confirm -> SIGTERM the
// server process -> restart on the SAME port -> the session is listed as live
// -> a third turn recalls the codeword (same claude session, context intact).
//
// The server MUST run as a child process (not in-process createApp): the point
// is that the OS process dies and a fresh one still finds the pane.
//
// Updated for #29: there is no remount scan and no settings file any more. The
// new server rediscovers nothing — it asks `agent.list` when the phone asks
// what is running, and ownership comes from the workspace label, which survives
// the restart. The session key is herdr's pane id, so the third turn is sent to
// a key server B never minted.
//
// Runs only against a real daemon (skipIf socket missing) and burns three real
// claude turns with minimal prompts. cwd = this repo's root, which must be a
// trusted directory (trust-dialog handling is deferred to #24).

const socketPath = resolveSocketPath();

// Repo root resolved from this file — the trusted cwd the session runs in.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const SERVER_ENTRY = join(REPO_ROOT, "server", "index.ts");

const SERVER_READY_DEADLINE_MS = 30_000;
const SERVER_EXIT_DEADLINE_MS = 10_000;
const CREATE_DEADLINE_MS = 45_000;
const TURN_DEADLINE_MS = 120_000;
const LIST_DEADLINE_MS = 10_000;
const READY_DEADLINE_MS = 60_000;
const TEST_TIMEOUT_MS = 240_000;

const CODEWORD = "ZEBRA-7";
const PROMPT_TURN_1 = `Remember the codeword ${CODEWORD}. Reply only: OK`;
const PROMPT_TURN_2 = "Confirm you still remember the codeword. Reply only: YES";
const PROMPT_TURN_3 = "What was the codeword? Reply with just the codeword.";

const PaneListResultSchema = z
  .object({
    panes: z.array(z.object({ pane_id: z.string(), workspace_id: z.string() }).passthrough()),
  })
  .passthrough();

/** Reserves a free port; the restarted server must rebind this exact number. */
function reserveEphemeralPort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error("failed to reserve an ephemeral port");
  return port;
}

/**
 * Spawns `bun server/index.ts --port <port>` as a real killable OS process.
 *
 * The server runs in its own process, so there is no `createApp` seam to inject
 * an audit path through; `CC_MOBILE_AUDIT_LOG` is the only way to keep this
 * suite's records out of the developer's own `~/.claude-mobile`. `process.env`
 * is spread rather than replaced — the child still needs PATH and whatever
 * resolves the herdr socket.
 */
function spawnServer(port: number, auditDir: string): Bun.Subprocess {
  return Bun.spawn(
    [process.execPath, SERVER_ENTRY, "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, CC_MOBILE_AUDIT_LOG: join(auditDir, "audit.jsonl") },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
}

/**
 * Polls until the server accepts HTTP on the port. index.ts listens once
 * verifyHerdrStartup passes; there is nothing else to wait for, because the
 * session list is derived on demand from the daemon rather than rebuilt at
 * startup. Fails fast if the child exits first (e.g. daemon gate fatal).
 */
async function waitForServerReady(
  proc: Bun.Subprocess,
  port: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + SERVER_READY_DEADLINE_MS;
  let exited = false;
  proc.exited.then(() => {
    exited = true;
  });
  while (Date.now() < deadline) {
    if (exited) throw new Error(`${label} exited (code ${proc.exitCode}) before becoming ready`);
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return; // any HTTP response means listen() ran
    } catch {
      await Bun.sleep(250);
    }
  }
  throw new Error(`${label} not ready on port ${port} within ${SERVER_READY_DEADLINE_MS}ms`);
}

async function killQuietly(proc: Bun.Subprocess | undefined): Promise<void> {
  if (proc === undefined || proc.exitCode !== null) return;
  try {
    proc.kill("SIGKILL");
    await withinMs(proc.exited, SERVER_EXIT_DEADLINE_MS, "server exit");
  } catch {
    // best-effort cleanup
  }
}

function withinMs<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} not observed within ${ms}ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

type ServerMsg = Record<string, unknown>;

/**
 * Ordered consumer over the raw WebSocket. Buffered replies arrive wrapped in
 * the `{type:"event", eventId, sessionId, payload}` envelope; connection-scoped
 * replies (terminal_sessions, terminal_teardown_result, error) arrive raw — both
 * are flattened to their payload. `next` consumes messages in arrival order,
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

function chunkText(msg: ServerMsg): string {
  const chunk = msg.chunk as
    | { message?: { content?: Array<{ type?: string; text?: string }> } }
    | undefined;
  const content = chunk?.message?.content;
  return Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : "";
}

async function openWs(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws connection failed")));
  });
  return ws;
}

/** One prompt -> assistant stream_chunk containing `expected` -> stream_end. */
async function runTurn(
  ws: WebSocket,
  collector: ReturnType<typeof createMessageCollector>,
  sessionId: string,
  prompt: string,
  expected: string,
  label: string,
  client: ReturnType<typeof createHerdrClient>,
): Promise<void> {
  const t = Date.now();
  // A precaution, not a proven fix: step 8 once answered an `error` frame
  // whose payload was not printed (2026-08-02), and this send is the one that
  // follows a restart by ~300ms — far faster than a human taps, and now also
  // much sooner after the settle, since the turn's end reaches the phone within
  // a tick of happening. The two candidates are `session_busy` from
  // send-routing's readiness probe and `session_error` from a throw inside the
  // `terminal_send` try block (ws.ts). This gate removes the first; the
  // assertion below prints the payload, so a recurrence names itself instead of
  // costing another live run. On the passing run it logged nothing — the pane
  // was ready on the first probe.
  await waitUntil(
    async () => {
      const info = await client.agentGet(sessionId).catch(() => null);
      if (info === null) return false;
      const ready = info.agent_status === "idle" || info.agent_status === "done";
      if (!ready) console.log(`[e2e] ${label} waiting, pane is ${info.agent_status}`);
      return ready;
    },
    READY_DEADLINE_MS,
    `${label} pane ready to accept a prompt`,
  );
  ws.send(JSON.stringify({ type: "terminal_send", claudeUuid: sessionId, content: prompt }));
  // Matched by content, not by position: the transcript reader delivers every
  // renderable record since its cursor, and claude's own `user` record — the
  // prompt echoed back — is one of them (server/transcript/records.ts). The
  // reply is the assistant chunk carrying `expected`, whichever chunk that is.
  const reply = await collector.next(
    (msg) =>
      msg.sessionId === sessionId &&
      (msg.type === "error" ||
        (msg.type === "stream_chunk" &&
          (msg.chunk as { type?: string }).type === "assistant" &&
          chunkText(msg).includes(expected))),
    TURN_DEADLINE_MS,
    `${label} assistant stream_chunk`,
  );
  // The payload, not just the name: an `error` here is the only thing the
  // server says about why a turn did not happen, and a bare "Received: error"
  // costs a whole live re-run to see it.
  expect(reply.type === "error" ? JSON.stringify(reply) : reply.type).toBe("stream_chunk");
  expect((reply.chunk as { type?: string }).type).toBe("assistant");
  expect(chunkText(reply)).toContain(expected);
  await collector.next(
    (msg) => msg.type === "stream_end" && msg.sessionId === sessionId,
    TURN_DEADLINE_MS,
    `${label} stream_end`,
  );
  console.log(`[e2e] ${label} reply in ${Date.now() - t}ms`);
}

it.skipIf(!existsSync(socketPath))(
  "live restart continuity: kill server -> restart same port -> session listed -> third turn recalls codeword",
  async () => {
    const port = reserveEphemeralPort();
    const client = createHerdrClient({ socketPath });
    const claudeUuid = crypto.randomUUID();

    let procA: Bun.Subprocess | undefined;
    let procB: Bun.Subprocess | undefined;
    let wsA: WebSocket | undefined;
    let wsB: WebSocket | undefined;
    let workspaceId: string | undefined;
    let tornDown = false;
    const auditDir = mkdtempSync(join(tmpdir(), "ccme2e-audit-"));

    try {
      // Step 1: server process A — a real OS process we can kill.
      procA = spawnServer(port, auditDir);
      await waitForServerReady(procA, port, "server A");

      // Step 2: create the live session over the mobile protocol.
      wsA = await openWs(port);
      const collectorA = createMessageCollector(wsA);
      const t2 = Date.now();
      wsA.send(JSON.stringify({ type: "terminal_create", claudeUuid, cwd: REPO_ROOT }));
      const created = await collectorA.next(
        (msg) => msg.type === "terminal_created" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "step 2 terminal_created",
      );
      expect(created.type).toBe("terminal_created");
      expect(created.claudeUuid).toBe(claudeUuid);
      const paneRef = created.paneRef as string;
      // The wire session key (Decision H5) — and the only key server B will
      // know, since it never minted the request uuid.
      const sessionId = created.sessionId as string;
      expect(sessionId).toBe(paneRef);
      console.log(`[e2e] step 2 terminal_created paneRef=${paneRef} in ${Date.now() - t2}ms`);

      // Record the workspace for the post-teardown assertion + finally cleanup.
      const panesBefore = await client.call("pane.list", {}, PaneListResultSchema);
      workspaceId = panesBefore.panes.find((pane) => pane.pane_id === paneRef)?.workspace_id;
      expect(workspaceId).toBeDefined();

      // Steps 3-4: teach the codeword, confirm it landed — two full turns.
      await runTurn(wsA, collectorA, sessionId, PROMPT_TURN_1, "OK", "step 3 turn 1", client);
      await runTurn(wsA, collectorA, sessionId, PROMPT_TURN_2, "YES", "step 4 turn 2", client);

      // Step 5: SIGTERM kills the server process but NOT the pane (D2 live
      // proof: no shutdown handler tears the workspace down anymore).
      const t5 = Date.now();
      procA.kill("SIGTERM");
      await withinMs(procA.exited, SERVER_EXIT_DEADLINE_MS, "server A exit");
      try {
        wsA.close();
      } catch {
        // socket died with the server
      }
      wsA = undefined;
      console.log(`[e2e] step 5 server A terminated in ${Date.now() - t5}ms`);

      // Step 6: server process B on the same port.
      const t6 = Date.now();
      procB = spawnServer(port, auditDir);
      await waitForServerReady(procB, port, "server B");
      console.log(`[e2e] step 6 server B ready in ${Date.now() - t6}ms`);

      // Step 7: the surviving session is in the authoritative live list — not
      // because anything was remounted, but because the daemon still has the
      // pane and its workspace still carries cc-mobile's ownership label.
      wsB = await openWs(port);
      const collectorB = createMessageCollector(wsB);
      wsB.send(JSON.stringify({ type: "list_terminal_sessions" }));
      const listed = await collectorB.next(
        (msg) => msg.type === "terminal_sessions",
        LIST_DEADLINE_MS,
        "step 7 terminal_sessions",
      );
      expect(listed.claudeUuids as string[]).toContain(sessionId);
      const descriptor = (listed.sessions as Array<Record<string, unknown>>).find(
        (session) => session.sessionId === sessionId,
      );
      // Ownership is label-derived, so it survives a process that has forgotten
      // everything (Decision M12) — which is what keeps teardown allowed below.
      expect(descriptor?.origin).toBe("self");
      console.log(`[e2e] step 7 session listed after restart`);

      // Step 8: third turn on the SAME session recalls the codeword — same live
      // claude, context intact across the restart, driven by a server process
      // that has no registry entry for it at all.
      await runTurn(wsB, collectorB, sessionId, PROMPT_TURN_3, CODEWORD, "step 8 turn 3", client);

      // Teardown through the mobile protocol; the daemon keeps no residue.
      wsB.send(JSON.stringify({ type: "terminal_teardown", sessionId }));
      const teardownResult = await collectorB.next(
        (msg) => msg.type === "terminal_teardown_result" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "teardown terminal_teardown_result",
      );
      expect(teardownResult.type).toBe("terminal_teardown_result");
      expect(teardownResult.killed).toBe(true);
      tornDown = true;
      const panesAfter = await client.call("pane.list", {}, PaneListResultSchema);
      expect(panesAfter.panes.some((pane) => pane.workspace_id === workspaceId)).toBe(false);
    } finally {
      // Cleanup always runs: sockets, then the workspace directly if the
      // protocol teardown did not complete, then both server processes.
      for (const ws of [wsA, wsB]) {
        try {
          ws?.close();
        } catch {
          // socket already gone
        }
      }
      if (!tornDown && workspaceId !== undefined) {
        await client
          .call("workspace.close", { workspace_id: workspaceId }, OkResultSchema)
          .catch(() => {});
      }
      await killQuietly(procA);
      await killQuietly(procB);
      rmSync(auditDir, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
