import { expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { createApp } from "../app";
import type { ServerConfig } from "../config";
import { createHerdrClient } from "../herdr/client";
import { OkResultSchema, PaneProcessInfoResultSchema } from "../herdr/schema";
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
 * E2ETranscriptReadback — a reply reaches the phone with no hook involved.
 *
 * This is the receipt for the whole teardown: the server writes no settings
 * file, claude is launched plain, and the answer still arrives — read out of
 * claude's own `~/.claude/projects/**.jsonl` when herdr reports the turn
 * settled. If the readback chain were still the Stop hook, this session (which
 * has no hook configured) would sit silent forever.
 */

const socketPath = resolveSocketPath();

/** Repo root resolved from this file — the trusted cwd the session runs in. */
const REPO_ROOT = join(import.meta.dir, "..", "..");

const CREATE_DEADLINE_MS = 45_000;
const TURN_DEADLINE_MS = 120_000;
const TEST_TIMEOUT_MS = 300_000;

it.skipIf(!existsSync(socketPath))(
  "live herdr: a self-launched session replies from its transcript, with no hook",
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

      ws.send(JSON.stringify({ type: "terminal_create", claudeUuid, cwd: REPO_ROOT }));
      const created = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_created" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "terminal_created",
      );
      expect(created.type).toBe("terminal_created");

      // The session key on the wire is herdr's pane id (Decision H5); the
      // request uuid only named the buffer slot this ack landed in.
      const sessionId = created.sessionId as string;
      expect(sessionId).toBe(created.paneRef as string);

      const panes = await client.call("pane.list", {}, PaneListResultSchema);
      workspaceId = panes.panes.find((pane) => pane.pane_id === sessionId)?.workspace_id;
      expect(workspaceId).toBeDefined();

      // Receipt for SelfLaunchNativeArgv: a plain claude. No `--settings`, so
      // no cc-mobile hook exists that could have delivered the reply below.
      const info = await client.call(
        "pane.process_info",
        { pane_id: sessionId },
        PaneProcessInfoResultSchema,
      );
      const claudeProc = (info.process_info.foreground_processes ?? []).find((proc) => {
        const names = [proc.argv0, proc.argv?.[0]];
        return names.some((name) => typeof name === "string" && basename(name) === "claude");
      });
      expect(claudeProc).toBeDefined();
      const argv = claudeProc?.argv ?? [];
      expect(argv).not.toContain("--settings");
      expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("default");
      expect(argv[argv.indexOf("--session-id") + 1]).toBe(claudeUuid);

      // One turn, answered from the transcript.
      ws.send(
        JSON.stringify({ type: "terminal_send", claudeUuid: sessionId, content: "what is 2+2" }),
      );

      const reply = await collector.next(
        (msg: ServerMsg) =>
          msg.type === "stream_chunk" && msg.sessionId === sessionId && /4/.test(chunkText(msg)),
        TURN_DEADLINE_MS,
        "assistant stream_chunk containing 4",
      );
      expect((reply.chunk as { type?: string }).type).toBe("assistant");

      const end = await collector.next(
        (msg: ServerMsg) => msg.type === "stream_end" && msg.sessionId === sessionId,
        TURN_DEADLINE_MS,
        "stream_end",
      );
      expect(end.sessionId).toBe(sessionId);

      ws.send(JSON.stringify({ type: "terminal_teardown", sessionId }));
      const teardown = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_teardown_result" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "terminal_teardown_result",
      );
      expect(teardown.type).toBe("terminal_teardown_result");
      expect(teardown.killed).toBe(true);
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
