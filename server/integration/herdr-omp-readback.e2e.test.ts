import { expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../app";
import type { ServerConfig } from "../config";
import { createHerdrClient } from "../herdr/client";
import { OkResultSchema } from "../herdr/schema";
import { resolveSocketPath } from "../herdr/transport";
import {
  chunkText,
  createMessageCollector,
  openSocket,
  PaneListResultSchema,
  reserveEphemeralPort,
  type ServerMsg,
} from "./e2e-harness";

/**
 * E2EOmpReadback — the headline of #32: an omp's reply reaches the phone.
 *
 * The chain under test is different from claude's at every link. herdr hands
 * back the transcript *path* rather than an id, so nothing is derived or
 * scanned; the file is written in omp's own record vocabulary, which the shared
 * mapper reads without being told whose file it is; and the file does not exist
 * at all until the first turn starts, so the session is listed unreadable
 * before the turn and readable after it — the one flag in this codebase that
 * legitimately changes for a pane that never changed.
 *
 * Needs a provider with quota: starting an omp costs nothing, but a turn that
 * never completes writes no assistant record. Verified available 2026-08-06.
 */

const socketPath = resolveSocketPath();

const REPO_ROOT = join(import.meta.dir, "..", "..");
const MARKER = "OMP-E2E-OK";

const CREATE_DEADLINE_MS = 90_000;
const TURN_DEADLINE_MS = 180_000;
const TEST_TIMEOUT_MS = 400_000;

/** The descriptor for `sessionId` in a fresh `terminal_sessions` reply. */
async function describeSession(
  ws: WebSocket,
  collector: ReturnType<typeof createMessageCollector>,
  sessionId: string,
): Promise<Record<string, unknown> | undefined> {
  ws.send(JSON.stringify({ type: "list_terminal_sessions" }));
  const listed = await collector.next(
    (msg: ServerMsg) => msg.type === "terminal_sessions",
    CREATE_DEADLINE_MS,
    "terminal_sessions reply",
  );
  return (listed.sessions as Array<Record<string, unknown>>).find(
    (session) => session.sessionId === sessionId,
  );
}

it.skipIf(!existsSync(socketPath))(
  "live herdr: an omp reply is read back, and readable flips once its file exists",
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

    let ws: WebSocket | undefined;
    let workspaceId: string | undefined;
    let tornDown = false;

    try {
      ws = await openSocket(port);
      const collector = createMessageCollector(ws);

      ws.send(
        JSON.stringify({ type: "terminal_create", claudeUuid, cwd: REPO_ROOT, agentKind: "omp" }),
      );
      const created = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_created" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "terminal_created for the omp session",
      );
      expect(created.type).toBe("terminal_created");
      const sessionId = created.sessionId as string;

      const panes = await client.call("pane.list", {}, PaneListResultSchema);
      workspaceId = panes.panes.find((pane) => pane.pane_id === sessionId)?.workspace_id;

      // Before the first turn: herdr already reports the transcript path, and
      // the file it names is not there. Promising readback here would promise a
      // conversation that has not started.
      const before = await describeSession(ws, collector, sessionId);
      expect(before).toBeDefined();
      expect(before?.readable).toBe(false);
      // Not because anything is missing — the key is present and absolute.
      expect(typeof before?.agentSessionValue).toBe("string");
      expect(before?.agentSessionValue as string).toMatch(/^\/.*\.jsonl$/);
      // The path kind never reaches the phone; only the value does.
      expect(Object.hasOwn(before ?? {}, "agentSessionKind")).toBe(false);
      // Unreadable is disclosure, never a lock (H4): it still takes a prompt.
      expect(before?.drivable).toBe(true);
      expect(before?.agent).toBe("omp");

      ws.send(
        JSON.stringify({
          type: "terminal_send",
          claudeUuid: sessionId,
          content: `Reply with exactly: ${MARKER}`,
        }),
      );

      // The reply, read out of omp's own file through the shared mapper. The
      // role has to be part of the match, not just an assertion after it: the
      // prompt itself contains the marker, and omp records the user turn in the
      // same file, so the first chunk carrying these characters is the echo of
      // what was just typed.
      const reply = await collector.next(
        (msg: ServerMsg) =>
          msg.type === "stream_chunk" &&
          msg.sessionId === sessionId &&
          (msg.chunk as { type?: string }).type === "assistant" &&
          chunkText(msg).includes(MARKER),
        TURN_DEADLINE_MS,
        `assistant stream_chunk containing ${MARKER}`,
      );
      // On disk omp files this under its own single conversational record type
      // with the role inside; what reaches the phone is claude's envelope,
      // which the client's dispatcher already renders.
      expect((reply.chunk as { type?: string }).type).toBe("assistant");

      // And now the file exists, so the same pane reads back as readable.
      const after = await describeSession(ws, collector, sessionId);
      expect(after?.readable).toBe(true);
      expect(after?.agentSessionValue).toBe(before?.agentSessionValue);

      ws.send(JSON.stringify({ type: "terminal_teardown", sessionId }));
      const teardown = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_teardown_result" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "terminal_teardown_result",
      );
      expect(teardown.type).toBe("terminal_teardown_result");
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
      await app.stop(true);
    }
  },
  TEST_TIMEOUT_MS,
);
