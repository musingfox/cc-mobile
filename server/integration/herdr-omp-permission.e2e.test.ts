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
 * E2EOmpPermissionFlow — the headline of #33: an omp's permission prompt is
 * answered from the phone.
 *
 * Every link differs from claude's. herdr reports `blocked` the same way, but
 * the screen carries omp's `Allow tool:` prompt rather than claude's numbered
 * "Do you want to proceed?", and the answer is arrow keys plus Enter aimed at a
 * cursor rather than a digit. The receipt is the same shape as claude's suite:
 * a canary file that never appears — not "the server said deny", but "the tool
 * did not run".
 *
 * This suite starts its own omp rather than going through `terminal_create`,
 * for a reason that is itself the ticket's scope boundary: omp's default
 * approval mode gates nothing (live check 2026-08-06 — a default omp wrote a
 * file without asking), and cc-mobile deliberately launches it with no approval
 * flag. So the prompts #33 handles are the ones on panes the user started
 * themselves with `--approval-mode always-ask`, which is exactly what this
 * builds.
 *
 * Needs a provider with quota — a turn that never runs raises no prompt.
 */

const socketPath = resolveSocketPath();

const REPO_ROOT = join(import.meta.dir, "..", "..");

const READY_DEADLINE_MS = 60_000;
const LIST_DEADLINE_MS = 30_000;
const TURN_DEADLINE_MS = 180_000;
const UNBLOCK_DEADLINE_MS = 30_000;
const TEST_TIMEOUT_MS = 400_000;

it.skipIf(!existsSync(socketPath))(
  "live herdr: an omp permission prompt reaches the phone and Deny blocks the tool",
  async () => {
    const port = reserveEphemeralPort();
    const serverConfig: ServerConfig = {
      port,
      hostname: "127.0.0.1",
      defaultCwd: null,
      allowedRoots: null,
      basePath: "",
    };
    // Same deviation as the foreign suite: this asserts on a pane it labelled
    // `ccme2e-`, which the production listing hides.
    const backend = createHerdrBackend({ suppressSessionLabel: () => false }) as AppBackend;
    const app = createApp(serverConfig, { backend });
    app.listen({ port, hostname: "127.0.0.1" });

    const client = createHerdrClient({ socketPath });
    const canaryDir = mkdtempSync(join(tmpdir(), "ccme2e-omp-canary-"));
    const canaryPath = join(canaryDir, "canary.txt");

    let ws: WebSocket | undefined;
    let workspaceId: string | undefined;

    try {
      const created = await client.call(
        "workspace.create",
        { label: `ccme2e-omp-perm-${Date.now()}`, cwd: REPO_ROOT, focus: false },
        WorkspaceCreatedResultSchema,
      );
      workspaceId = created.workspace.workspace_id;
      const paneId = created.root_pane.pane_id;

      await client.call(
        "agent.start",
        {
          name: `ccme2e${Date.now().toString(36).slice(-6)}`,
          kind: "omp",
          pane_id: paneId,
          args: ["--approval-mode", "always-ask"],
        },
        AgentStartedResultSchema,
      );

      await waitUntil(
        async () => (await client.agentGet(paneId).catch(() => null))?.interactive_ready === true,
        READY_DEADLINE_MS,
        "the omp composer accepting input",
      );

      ws = await openSocket(port);
      const collector = createMessageCollector(ws);

      // The pane is listed, and its gate is read in omp's own vocabulary.
      ws.send(JSON.stringify({ type: "list_terminal_sessions" }));
      const listed = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_sessions",
        LIST_DEADLINE_MS,
        "terminal_sessions reply",
      );
      const mine = (listed.sessions as Array<Record<string, unknown>>).find(
        (session) => session.sessionId === paneId,
      );
      expect(mine?.agent).toBe("omp");
      // `--approval-mode always-ask` is what gated means for an omp; claude's
      // flag name would find nothing here and report the opposite.
      expect(mine?.gated).toBe(true);

      expect(existsSync(canaryPath)).toBe(false);
      ws.send(
        JSON.stringify({
          type: "terminal_send",
          claudeUuid: paneId,
          content: `Run this exact shell command and nothing else: touch ${canaryPath}`,
        }),
      );

      const request = await collector.next(
        (msg: ServerMsg) => msg.type === "permission_request" && msg.sessionId === paneId,
        TURN_DEADLINE_MS,
        "permission_request from the omp pane",
      );

      // The terminal's own wording, parsed rather than synthesised: omp draws
      // two options for a bash call, not the four its bundle defines.
      const options = request.options as Array<{ id: string; label: string }>;
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options.map((option) => option.label)).toContain("Approve");
      const deny = options.find((option) => /^(deny|reject)\b/i.test(option.label));
      expect(deny).toBeDefined();
      const tool = request.tool as { name: string; parameters: Record<string, unknown> };
      expect(tool.name).toBe("bash");
      expect(String(tool.parameters.text)).toContain(canaryPath);

      ws.send(
        JSON.stringify({ type: "permission", requestId: request.requestId, optionId: deny?.id }),
      );

      // The receipt: the pane leaves blocked, and the tool never ran. Nothing
      // here asserts on which keys were pressed — that the arrow keys landed on
      // Deny is what the missing file proves.
      await waitUntil(
        async () => {
          const info = await client.agentGet(paneId).catch(() => null);
          return info !== null && info.agent_status !== "blocked";
        },
        UNBLOCK_DEADLINE_MS,
        "the omp pane leaving blocked after the answer",
      );
      expect(existsSync(canaryPath)).toBe(false);
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
      rmSync(canaryDir, { recursive: true, force: true });
      await app.stop(true);
    }
  },
  TEST_TIMEOUT_MS,
);
