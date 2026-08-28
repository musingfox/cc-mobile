import { expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createApp } from "../app";
import { createAgentProfileSource } from "../agents/profiles";
import type { ServerConfig } from "../config";
import { createHerdrClient } from "../herdr/client";
import { OkResultSchema, PaneProcessInfoResultSchema } from "../herdr/schema";
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
 * LiveProfileArgvReceipt — the operator's argv really reaches the process.
 *
 * A launch profile is a server-side fact: the phone names an id, the server
 * owns the flags, and nothing about them travels on the wire. The only way to
 * show the id was honoured is to read the argv off the running process, which
 * is what `pane.process_info` reports here — the same receipt the transcript
 * suite takes for `--session-id`.
 *
 * The profile file is written into this run's own temp directory and injected
 * through `createApp`'s seam: the real loader reads a real file, but never the
 * developer's `~/.claude-mobile`.
 *
 * The pane started here is an ordinary omp. Nothing downstream knows a profile
 * existed — the listing reads `agent` and `gated` off the process exactly as it
 * does for a bare launch, which is why `gated` comes back true purely because
 * the operator's flag is in the argv.
 */

const socketPath = resolveSocketPath();

/** Repo root resolved from this file — the trusted cwd the session runs in. */
const REPO_ROOT = join(import.meta.dir, "..", "..");

const PROFILE_ID = "e2e-omp-gated";
const PROFILE_ARGS = ["--approval-mode", "always-ask"];

const CREATE_DEADLINE_MS = 90_000;
const LIST_DEADLINE_MS = 30_000;
const TEST_TIMEOUT_MS = 300_000;

it.skipIf(!existsSync(socketPath))(
  "live herdr: a pane launched from a profile runs the operator's argv and lists as an ordinary omp",
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
    // 稽核紀錄與 profile 檔都寫進本次測試自己的暫存目錄，不碰開發者的 `~/.claude-mobile`。
    const auditDir = mkdtempSync(join(tmpdir(), "ccme2e-audit-"));
    const profileDir = mkdtempSync(join(tmpdir(), "ccme2e-profiles-"));
    const profilePath = join(profileDir, "agent-profiles.json");
    writeFileSync(
      profilePath,
      JSON.stringify([
        {
          id: PROFILE_ID,
          label: "omp (always ask)",
          kind: "omp",
          args: PROFILE_ARGS,
        },
      ]),
    );

    const app = createApp(serverConfig, {
      auditLogPath: join(auditDir, "audit.jsonl"),
      agentProfiles: createAgentProfileSource({ path: profilePath }),
    });
    app.listen({ port, hostname: "127.0.0.1" });

    const client = createHerdrClient({ socketPath });
    const claudeUuid = crypto.randomUUID();

    let paneId: string | undefined;
    let ws: WebSocket | undefined;

    try {
      ws = await openSocket(port);
      const collector = createMessageCollector(ws);

      // 1. An id no profile file declares is refused, and refused before any
      //    workspace exists — the pane set is unchanged across the exchange.
      const panesBefore = await client.call("pane.list", {}, PaneListResultSchema);
      const idsBefore = new Set(panesBefore.panes.map((pane) => pane.pane_id));

      ws.send(
        JSON.stringify({
          type: "terminal_create",
          claudeUuid: crypto.randomUUID(),
          cwd: REPO_ROOT,
          profileId: "no-such-profile",
        }),
      );
      const refusal = await collector.next(
        (msg: ServerMsg) => msg.type === "error" || msg.type === "terminal_created",
        LIST_DEADLINE_MS,
        "reply to an undeclared profileId",
      );
      expect(refusal.type).toBe("error");
      expect(refusal.code).toBe("unknown_profile");

      const panesAfterRefusal = await client.call("pane.list", {}, PaneListResultSchema);
      const appeared = panesAfterRefusal.panes
        .map((pane) => pane.pane_id)
        .filter((id) => !idsBefore.has(id));
      expect(appeared).toEqual([]);

      // 2. The real thing: the phone names the id only, and the server supplies
      //    the flags behind it.
      ws.send(
        JSON.stringify({
          type: "terminal_create",
          claudeUuid,
          cwd: REPO_ROOT,
          profileId: PROFILE_ID,
        }),
      );
      const created = await collector.next(
        (msg: ServerMsg) => msg.type === "terminal_created" || msg.type === "error",
        CREATE_DEADLINE_MS,
        "terminal_created for the profile session",
      );
      expect(created.type).toBe("terminal_created");
      paneId = created.sessionId as string;
      expect(typeof paneId).toBe("string");

      // 3. The receipt, read off the running process rather than off anything
      //    cc-mobile said about it.
      const info = await client.call(
        "pane.process_info",
        { pane_id: paneId },
        PaneProcessInfoResultSchema,
      );
      const ompProc = (info.process_info.foreground_processes ?? []).find((proc) => {
        const names = [proc.argv0, proc.argv?.[0]];
        return names.some((name) => typeof name === "string" && basename(name) === "omp");
      });
      expect(ompProc).toBeDefined();
      const argv = ompProc?.argv ?? [];
      expect(argv[argv.indexOf("--approval-mode") + 1]).toBe("always-ask");

      // 4. And it is an ordinary omp afterwards: the listing reads its kind and
      //    its gating posture off that same process, with no profile branch.
      //    Kind detection lags the launch and nothing pushes it, so the listing
      //    is re-asked exactly as the phone would on a pull-to-refresh (#30).
      let descriptor: Record<string, unknown> | undefined;
      await waitUntil(
        async () => {
          ws?.send(JSON.stringify({ type: "list_terminal_sessions" }));
          const listed = await collector.next(
            (msg: ServerMsg) => msg.type === "terminal_sessions",
            LIST_DEADLINE_MS,
            "terminal_sessions reply",
          );
          const sessions = listed.sessions as Array<Record<string, unknown>>;
          descriptor = sessions.find((session) => session.sessionId === paneId);
          return descriptor?.agent === "omp";
        },
        LIST_DEADLINE_MS,
        "the listing reporting agent:'omp' for the pane started from the profile",
      );
      expect(descriptor?.agent).toBe("omp");
      expect(descriptor?.gated).toBe(true);

      // 5. cc-mobile launched it, so cc-mobile can close it.
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
      // Belt and braces: a failure before step 5 leaves an omp running in the
      // user's own herdr.
      if (paneId !== undefined) {
        const workspaceId = paneId.split(":")[0];
        await client
          .call("workspace.close", { workspace_id: workspaceId }, OkResultSchema)
          .catch(() => {});
      }
      rmSync(auditDir, { recursive: true, force: true });
      rmSync(profileDir, { recursive: true, force: true });
      await app.stop(true);
    }
  },
  TEST_TIMEOUT_MS,
);
