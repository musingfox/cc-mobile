import { expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import type { ServerConfig } from "../config";
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
 * This suite starts its own claude with `--permission-mode default` rather than
 * going through `terminal_create`, and that is the point rather than a detail:
 * cc-mobile stopped passing any gating flag, so a session it launches runs at
 * the machine's own claude settings — which on a developer's machine may well
 * be `auto` with a long allow-list, and would never raise a prompt to answer.
 * The prompts this flow exists for are the ones on panes configured to ask,
 * which is exactly what this builds. Same shape as the omp suite.
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

function auditActions(path: string): string[] {
  try {
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).action as string);
  } catch {
    return [];
  }
}

it.skipIf(!existsSync(socketPath))(
  "live herdr: a blocked pane is denied and both sends share one audit file",
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
    const auditDir = mkdtempSync(join(tmpdir(), "ccme2e-audit-"));
    const auditLogPath = join(auditDir, "audit.jsonl");
    // 此測試自行標記 ccme2e pane；保留它才能走完整的真實訂閱與權限管線。
    const app = createApp(serverConfig, {
      auditLogPath,
      suppressSessionLabel: () => false,
    });
    app.listen({ port, hostname: "127.0.0.1" });

    const client = createHerdrClient({ socketPath });
    const canaryDir = mkdtempSync(join(tmpdir(), "ccme2e-canary-"));
    const canaryPath = join(canaryDir, "canary.txt");

    let ws: WebSocket | undefined;
    let workspaceId: string | undefined;

    try {
      // A claude configured to ask — the posture cc-mobile no longer imposes,
      // and the only one where there is a prompt to answer.
      const created = await client.call(
        "workspace.create",
        { label: `ccme2e-perm-${Date.now()}`, cwd: REPO_ROOT, focus: false },
        WorkspaceCreatedResultSchema,
      );
      workspaceId = created.workspace.workspace_id;
      const sessionId = created.root_pane.pane_id;

      await client.call(
        "agent.start",
        {
          name: `ccme2e${Date.now().toString(36).slice(-6)}`,
          kind: "claude",
          pane_id: sessionId,
          args: ["--permission-mode", "default"],
        },
        AgentStartedResultSchema,
      );

      await waitUntil(
        async () =>
          (await client.agentGet(sessionId).catch(() => null))?.interactive_ready === true,
        CREATE_DEADLINE_MS,
        "the claude composer accepting input",
      );

      ws = await openSocket(port);
      const collector = createMessageCollector(ws);

      // Asking for the listing is also what opens the pane event stream, and
      // `blocked` only reaches the permission flow through it. A suite that
      // launches its own pane has to ask — `terminal_create` would have done
      // this implicitly.
      ws.send(JSON.stringify({ type: "list_terminal_sessions" }));
      const listed = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_sessions",
        CREATE_DEADLINE_MS,
        "terminal_sessions reply",
      );
      const mine = (listed.sessions as Array<Record<string, unknown>>).find(
        (session) => session.sessionId === sessionId,
      );
      expect(mine?.agent).toBe("claude");
      // Launched with `--permission-mode default`, so its own argv says it asks.
      expect(mine?.gated).toBe(true);

      expect(existsSync(canaryPath)).toBe(false);
      ws.send(
        JSON.stringify({
          type: "terminal_send",
          claudeUuid: sessionId,
          content: `Run this exact bash command: touch ${canaryPath}`,
        }),
      );
      await waitUntil(
        () => Promise.resolve(auditActions(auditLogPath).includes("prompt_send")),
        UNBLOCK_DEADLINE_MS,
        "prompt_send audit record",
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
      await waitUntil(
        () => Promise.resolve(auditActions(auditLogPath).includes("permission_keys_send")),
        UNBLOCK_DEADLINE_MS,
        "permission_keys_send audit record",
      );
      const actions = auditActions(auditLogPath);
      expect(actions).toContain("prompt_send");
      expect(actions).toContain("permission_keys_send");
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
      rmSync(auditDir, { recursive: true, force: true });
      await app.stop(true);
    }
  },
  TEST_TIMEOUT_MS,
);
