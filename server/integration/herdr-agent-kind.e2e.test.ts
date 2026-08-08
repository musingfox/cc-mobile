import { expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../app";
import type { ServerConfig } from "../config";
import { createHerdrClient } from "../herdr/client";
import { OkResultSchema } from "../herdr/schema";
import { resolveSocketPath } from "../herdr/transport";
import {
  createMessageCollector,
  openSocket,
  reserveEphemeralPort,
  type ServerMsg,
  waitUntil,
} from "./e2e-harness";

/**
 * E2EAgentKindLaunch — the headline of #31.
 *
 * The phone asks for an omp, and an omp is what starts: `terminal_create`
 * carries the kind, herdr execs it, and the pane comes back in the session list
 * labelled `agent:"omp"`. Everything here goes over the real WS, through the
 * real registry, to the real daemon — the point is that the whole chain agrees
 * on the kind, which no unit test can show.
 *
 * The pane is created by cc-mobile itself, so its workspace carries a `ccm-`
 * label and the production listing does not hide it: no backend override here,
 * unlike the foreign suite.
 */

const socketPath = resolveSocketPath();

const CREATE_DEADLINE_MS = 90_000;
const LIST_DEADLINE_MS = 30_000;
const TEST_TIMEOUT_MS = 180_000;

it.skipIf(!existsSync(socketPath))(
  "live herdr: a phone-chosen agent kind reaches agent.start and comes back in the listing",
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
    const app = createApp(serverConfig);
    app.listen({ port, hostname: "127.0.0.1" });

    const client = createHerdrClient({ socketPath });
    const cwd = join(import.meta.dir, "..", "..");
    const claudeUuid = crypto.randomUUID();

    let paneId: string | undefined;
    let ws: WebSocket | undefined;

    try {
      ws = await openSocket(port);
      const collector = createMessageCollector(ws);

      // 1. The machine reports what it can launch. omp is on this machine's
      //    PATH, which is also why the rest of this test can run at all.
      ws.send(JSON.stringify({ type: "get_server_config" }));
      const config = await collector.next(
        (msg: ServerMsg) => msg.type === "server_config",
        LIST_DEADLINE_MS,
        "server_config reply",
      );
      const available = (config.config as { availableAgents?: string[] }).availableAgents;
      expect(available).toContain("claude");
      expect(available).toContain("omp");

      // 2. A kind cc-mobile does not launch is refused by the gate — before any
      //    workspace is created, let alone an agent started.
      ws.send(
        JSON.stringify({
          type: "terminal_create",
          claudeUuid: crypto.randomUUID(),
          cwd,
          agentKind: "codex",
        }),
      );
      const refusal = await collector.next(
        (msg: ServerMsg) => msg.type === "error" || msg.type === "terminal_created",
        LIST_DEADLINE_MS,
        "reply to an unsupported agentKind",
      );
      expect(refusal.type).toBe("error");
      expect(refusal.code).toBe("invalid_message");

      // 3. The real thing: start an omp from the phone.
      ws.send(JSON.stringify({ type: "terminal_create", claudeUuid, cwd, agentKind: "omp" }));
      const createdMsg = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_created" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "terminal_created for the omp session",
      );
      expect(createdMsg.type).toBe("terminal_created");
      paneId = createdMsg.sessionId as string;
      expect(typeof paneId).toBe("string");

      // 4. herdr agrees on what is running there. Kind detection lags the launch
      //    by a beat, and nothing pushes it — so the listing is re-asked, exactly
      //    as the phone would on a pull-to-refresh (#30).
      let listedAgent: unknown;
      await waitUntil(
        async () => {
          ws?.send(JSON.stringify({ type: "list_terminal_sessions" }));
          const listed = await collector.next(
            (msg: ServerMsg) => msg.type === "terminal_sessions",
            LIST_DEADLINE_MS,
            "terminal_sessions reply",
          );
          const sessions = listed.sessions as Array<Record<string, unknown>>;
          listedAgent = sessions.find((session) => session.sessionId === paneId)?.agent;
          return listedAgent === "omp";
        },
        LIST_DEADLINE_MS,
        "the listing reporting agent:'omp' for the pane cc-mobile just started",
      );
      expect(listedAgent).toBe("omp");

      // 5. And cc-mobile owns this one, so it can close it — unlike a foreign pane.
      ws.send(JSON.stringify({ type: "terminal_teardown", sessionId: paneId }));
      const torn = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_teardown_result" || msg.type === "error",
        LIST_DEADLINE_MS,
        "teardown result",
      );
      expect(torn.type).toBe("terminal_teardown_result");
      expect(torn.killed).toBe(true);
      paneId = undefined;
    } finally {
      try {
        ws?.close();
      } catch {
        // socket already gone
      }
      // Belt and braces: if the test failed before step 5, the pane is still
      // running an omp in the user's herdr.
      if (paneId !== undefined) {
        const workspaceId = paneId.split(":")[0];
        await client
          .call("workspace.close", { workspace_id: workspaceId }, OkResultSchema)
          .catch(() => {});
      }
      await app.stop(true);
    }
  },
  TEST_TIMEOUT_MS,
);
