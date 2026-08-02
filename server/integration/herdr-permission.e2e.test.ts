import { expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import type { ServerConfig } from "../config";
import { createHerdrClient } from "../herdr/client";
import { OkResultSchema } from "../herdr/schema";
import { resolveSocketPath } from "../herdr/transport";
import {
  createMessageCollector,
  openSocket,
  PaneListResultSchema,
  reserveEphemeralPort,
  type ServerMsg,
  waitUntil,
} from "./e2e-harness";

/**
 * E2ENativePermissionFlow — the permission gate with no hook behind it.
 *
 * herdr reports the pane `blocked`, the server reads the prompt off the pane's
 * screen and forwards the terminal's OWN options, and the phone's answer is a
 * keystroke pressed in that pane. The receipt is a canary file that never
 * appears: not "the server said deny", but "the tool did not run".
 *
 * The canary lives in a fresh temp dir, deliberately outside the session's cwd,
 * so claude has to ask before touching it.
 *
 * Runs only against a real daemon and burns one real claude turn. cwd = this
 * repo's root, a trusted directory (no trust dialog under default mode).
 */

const socketPath = resolveSocketPath();

/** Repo root resolved from this file — the trusted cwd the session runs in. */
const REPO_ROOT = join(import.meta.dir, "..", "..");

const CREATE_DEADLINE_MS = 45_000;
const TURN_DEADLINE_MS = 120_000;
const UNBLOCK_DEADLINE_MS = 10_000;
const TEST_TIMEOUT_MS = 400_000;

it.skipIf(!existsSync(socketPath))(
  "live herdr: a blocked pane raises the terminal's own options, and No blocks the tool",
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
    const canaryDir = mkdtempSync(join(tmpdir(), "ccme2e-canary-"));
    const canaryPath = join(canaryDir, "canary.txt");

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
      const sessionId = created.sessionId as string;

      const panes = await client.call("pane.list", {}, PaneListResultSchema);
      workspaceId = panes.panes.find((pane) => pane.pane_id === sessionId)?.workspace_id;
      expect(workspaceId).toBeDefined();

      expect(existsSync(canaryPath)).toBe(false);
      ws.send(
        JSON.stringify({
          type: "terminal_send",
          claudeUuid: sessionId,
          content: `Run this exact bash command: touch ${canaryPath}`,
        }),
      );

      // The prompt reaches the phone in the terminal's own wording.
      const request = await collector.next(
        (msg: ServerMsg) => msg.type === "permission_request" && msg.sessionId === sessionId,
        TURN_DEADLINE_MS,
        "permission_request",
      );
      const options = request.options as Array<{ id: string; label: string; keystroke: string }>;
      expect(Array.isArray(options)).toBe(true);
      // A Bash prompt offers at least Yes / No; the exact count is the
      // terminal's business, which is why the server parses it rather than
      // assuming it.
      expect(options.length).toBeGreaterThanOrEqual(2);
      const parameters = (request.tool as { parameters: Record<string, unknown> }).parameters;
      expect(String(parameters.text)).toContain(canaryPath);

      // Answer with the terminal's own "No".
      const no = options.find((option) => /^no\b/i.test(option.label));
      expect(no).toBeDefined();
      ws.send(
        JSON.stringify({ type: "permission", requestId: request.requestId, optionId: no?.id }),
      );

      // The receipt: the pane stops being blocked, and the tool never ran.
      await waitUntil(
        async () => {
          const info = await client.agentGet(sessionId).catch(() => null);
          return info !== null && info.agent_status !== "blocked";
        },
        UNBLOCK_DEADLINE_MS,
        "pane leaving blocked after the answer",
      );
      expect(existsSync(canaryPath)).toBe(false);

      // The turn still closes, so the phone's spinner does not hang.
      const end = await collector.next(
        (msg: ServerMsg) => msg.type === "stream_end" && msg.sessionId === sessionId,
        TURN_DEADLINE_MS,
        "stream_end after the denial",
      );
      expect(end.sessionId).toBe(sessionId);
      expect(existsSync(canaryPath)).toBe(false);

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
      rmSync(canaryDir, { recursive: true, force: true });
      await app.stop(true);
    }
  },
  TEST_TIMEOUT_MS,
);
