import { expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppBackend, createApp } from "../app";
import type { ServerConfig } from "../config";
import { createHerdrBackend } from "../herdr/backend";
import { createHerdrClient } from "../herdr/client";
import { OkResultSchema } from "../herdr/schema";
import { resolveSocketPath } from "../herdr/transport";
import {
  AgentStartedResultSchema,
  createMessageCollector,
  openSocket,
  reserveEphemeralPort,
  type ServerMsg,
  WorkspaceCreatedResultSchema,
  waitUntil,
} from "./e2e-harness";

/**
 * E2EForeignSessionListed — the headline of #29.
 *
 * A `claude` this test starts the way a human would (its own workspace, its own
 * `agent.start`, no cc-mobile launcher, no settings file, no hooks) must show up
 * in the phone's session list, marked as belonging to a terminal, with a
 * transcript key that makes it readable.
 *
 * The suite labels its workspace `ccme2e-*`, which the production listing hides
 * so live tests never pollute a user's session list — so this suite injects a
 * backend with the suppression disabled, in order to assert on its own pane.
 */

const socketPath = resolveSocketPath();

const READY_DEADLINE_MS = 60_000;
const LIST_DEADLINE_MS = 15_000;
const TEST_TIMEOUT_MS = 180_000;

it.skipIf(!existsSync(socketPath))(
  "live herdr: a claude started outside cc-mobile is listed, foreign and readable",
  async () => {
    const port = reserveEphemeralPort();
    const serverConfig: ServerConfig = {
      port,
      hostname: "127.0.0.1",
      defaultCwd: null,
      allowedRoots: null,
      pushScope: "phone-last" as const,
      basePath: "",
    };

    // The one deviation from production wiring: this suite is asserting on a
    // pane it labelled `ccme2e-`, which the real listing deliberately hides.
    const backend = createHerdrBackend({ suppressSessionLabel: () => false }) as AppBackend;
    // 稽核紀錄寫進本次測試自己的暫存檔，不碰開發者的 `~/.claude-mobile`。
    const auditDir = mkdtempSync(join(tmpdir(), "ccme2e-audit-"));
    const app = createApp(serverConfig, { backend, auditLogPath: join(auditDir, "audit.jsonl") });
    app.listen({ port, hostname: "127.0.0.1" });

    const client = createHerdrClient({ socketPath });
    // The repo root, not a fresh temp dir: claude shows its trust dialog in an
    // untrusted directory and never reaches SessionStart, so herdr's integration
    // never reports a session id and the wait below would always time out.
    const cwd = join(import.meta.dir, "..", "..");

    let workspaceId: string | undefined;
    let ws: WebSocket | undefined;

    try {
      // A session the user opened themselves: their own workspace, their own
      // `claude`, with nothing cc-mobile installed anywhere near it.
      const created = await client.call(
        "workspace.create",
        { label: `ccme2e-foreign-${Date.now()}`, cwd, focus: false },
        WorkspaceCreatedResultSchema,
      );
      workspaceId = created.workspace.workspace_id;
      const paneId = created.root_pane.pane_id;

      await client.call(
        "agent.start",
        { name: `ccme2e${Date.now().toString(36).slice(-6)}`, kind: "claude", pane_id: paneId },
        AgentStartedResultSchema,
      );

      // herdr needs a moment to detect the agent and read its session id out of
      // the SessionStart hook its own integration installs. Both halves are
      // waited for: the session id alone leaves `readable` racing the kind,
      // which is what decides whether a transcript reader exists at all, and
      // the two do not land together.
      await waitUntil(
        async () => {
          const info = await client.agentGet(paneId).catch(() => null);
          return typeof info?.agent_session?.value === "string" && typeof info?.agent === "string";
        },
        READY_DEADLINE_MS,
        "herdr detecting the foreign claude's kind and session id",
      );

      ws = await openSocket(port);
      const collector = createMessageCollector(ws);
      ws.send(JSON.stringify({ type: "list_terminal_sessions" }));

      const listed = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_sessions",
        LIST_DEADLINE_MS,
        "terminal_sessions reply",
      );

      const sessions = listed.sessions as Array<Record<string, unknown>>;
      expect(Array.isArray(sessions)).toBe(true);
      const mine = sessions.find((session) => session.sessionId === paneId);
      expect(mine).toBeDefined();
      expect(mine?.cwd).toBe(cwd);
      // Nobody's session but the user's: no `ccm-<uuid>` label on that workspace.
      expect(mine?.origin).toBe("foreign");
      // A transcript key means its replies can be read back on the phone.
      expect(typeof mine?.agentSessionValue).toBe("string");
      expect(mine?.readable).toBe(true);
      expect(mine?.drivable).toBe(true);
      // `claudeUuids` mirrors the pane ids, in the same order.
      expect(listed.claudeUuids).toEqual(sessions.map((session) => session.sessionId));
      // The wire never carries the removed remount artefact any more.
      expect(Object.hasOwn(listed, "unknownUuids")).toBe(false);

      // And cc-mobile refuses to close a terminal it does not own.
      ws.send(JSON.stringify({ type: "terminal_teardown", sessionId: paneId }));
      const refusal = await collector.next(
        (msg: ServerMsg) => msg.type === "error" || msg.type === "terminal_teardown_result",
        LIST_DEADLINE_MS,
        "teardown refusal",
      );
      expect(refusal.type).toBe("error");
      expect(refusal.code).toBe("session_not_owned");
    } finally {
      try {
        ws?.close();
      } catch {
        // socket already gone
      }
      if (workspaceId !== undefined) {
        await client
          .call("workspace.close", { workspace_id: workspaceId }, OkResultSchema)
          .catch(() => {});
      }
      // cwd is the repo itself — nothing to remove, and removing it would be
      // catastrophic.
      rmSync(auditDir, { recursive: true, force: true });
      await app.stop(true);
    }
  },
  TEST_TIMEOUT_MS,
);
