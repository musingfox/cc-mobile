/**
 * registry.ts — HerdrCreateSession + HerdrTeardown: cc-mobile-owned claude
 * sessions living in herdr workspaces.
 *
 * Mirrors tmux-registry's lifecycle contract (per-uuid settings file, the exact
 * claude argv, duplicate-uuid rejection, settings unlink on teardown) with the
 * launch swapped to herdr's two-step: `workspace.create` for a pane at a shell
 * prompt, then `agent.start` into that pane. The daemon assembles argv itself
 * and passes `args` through verbatim, so the tmux argv transfers unchanged —
 * which is what keeps `--session-id` (Stop-hook keying) and `--settings` (hook
 * wiring) working identically on both backends.
 *
 * `buildClaudeSettings` is imported rather than re-implemented: the hook shape
 * is one contract, not two.
 */

import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZodType } from "zod";
import { z } from "zod";
import { buildClaudeSettings } from "../tmux-registry";
import type { AgentGetFn } from "./readiness";
import { waitForInteractiveReady } from "./readiness";

// ── Wire schemas (local: these three RPCs have no typed client method) ────────

const WorkspaceCreatedResultSchema = z
  .object({
    type: z.literal("workspace_created"),
    workspace: z.object({ workspace_id: z.string() }).passthrough(),
    root_pane: z.object({ pane_id: z.string() }).passthrough(),
  })
  .passthrough();

const OkSchema = z.object({ type: z.literal("ok") }).passthrough();

// ── Types ────────────────────────────────────────────────────────────────────

/** The client slice this registry needs; the real HerdrClient satisfies it. */
export interface HerdrRegistryClient {
  call<T = unknown>(method: string, params: unknown, schema?: ZodType<T>): Promise<T>;
  agentGet: AgentGetFn;
}

export interface HerdrSessionEntry {
  workspaceId: string;
  paneId: string;
  agentName: string;
  settingsPath: string;
}

export interface HerdrRegistryOptions {
  client: HerdrRegistryClient;
  /** Full URL for the Stop hook POST target. */
  responseUrl?: string;
  /** Full URL for the PreToolUse hook POST target. */
  permissionUrl?: string;
  /** Readiness gate tuning + test seams. */
  readinessBudgetMs?: number;
  readinessPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CreateSessionInput {
  claudeUuid: string;
  cwd: string;
}

export interface HerdrCreateSessionResult {
  /** herdr agent name — also the desktop attach target (`herdr agent attach <name>`). */
  agentName: string;
  paneId: string;
  settingsPath: string;
}

/**
 * herdr agent names are 1-32 chars matching `[a-z][a-z0-9_-]*`, so the full
 * uuid (40 chars with the prefix) is rejected. The uuid↔pane mapping lives in
 * this registry instead of in the daemon's name field.
 */
export function agentNameFor(claudeUuid: string): string {
  return `ccm-${claudeUuid.slice(0, 8).toLowerCase()}`;
}

export function createHerdrRegistry(options: HerdrRegistryOptions) {
  const { client } = options;
  const responseUrl = options.responseUrl ?? "http://127.0.0.1:3001/api/pty-response";
  const permissionUrl = options.permissionUrl ?? "http://127.0.0.1:3001/api/pty-permission";

  // The hooks live one directory up, next to the tmux path that also uses them.
  const STOP_HOOK_PATH = join(import.meta.dir, "..", "pty-stop-hook.ts");
  const PERM_HOOK_PATH = join(import.meta.dir, "..", "pty-permission-hook.ts");

  const sessions = new Map<string, HerdrSessionEntry>();

  async function createSession(input: CreateSessionInput): Promise<HerdrCreateSessionResult> {
    const { claudeUuid, cwd } = input;

    if (sessions.has(claudeUuid)) {
      throw new Error(`already registered: ${claudeUuid}`);
    }

    const agentName = agentNameFor(claudeUuid);
    const settingsPath = join(tmpdir(), `ccm-settings-${claudeUuid}.json`);

    const settingsObj = buildClaudeSettings({
      responseUrl,
      stopHookPath: STOP_HOOK_PATH,
      permissionUrl,
      permissionHookPath: PERM_HOOK_PATH,
    });
    // Written before any RPC so the failure path below always has a file to unlink.
    await writeFile(settingsPath, JSON.stringify(settingsObj, null, 2), "utf8");

    let workspaceId: string | undefined;
    try {
      // Caller (tmux-control) has already checked that cwd exists — required,
      // because workspace.create silently falls back to $HOME otherwise.
      const created = await client.call(
        "workspace.create",
        { label: agentName, cwd, focus: false },
        WorkspaceCreatedResultSchema,
      );
      workspaceId = created.workspace.workspace_id;
      const paneId = created.root_pane.pane_id;

      // argv is passed through verbatim by the daemon — identical to tmux's.
      await client.call(
        "agent.start",
        {
          name: agentName,
          kind: "claude",
          pane_id: paneId,
          args: [
            "--permission-mode",
            "bypassPermissions",
            "--settings",
            settingsPath,
            "--session-id",
            claudeUuid,
          ],
        },
        OkSchema,
      );

      await waitForInteractiveReady({
        agentGet: client.agentGet,
        paneId,
        budgetMs: options.readinessBudgetMs,
        pollMs: options.readinessPollMs,
        sleep: options.sleep,
        now: options.now,
      });

      sessions.set(claudeUuid, { workspaceId, paneId, agentName, settingsPath });
      return { agentName, paneId, settingsPath };
    } catch (error) {
      // Leave nothing half-created: the pane (and the claude in it) would
      // otherwise outlive a failed create with no uuid mapping to reach it.
      await closeWorkspaceQuietly(workspaceId);
      await unlinkQuietly(settingsPath);
      throw error;
    }
  }

  async function closeWorkspaceQuietly(workspaceId: string | undefined): Promise<void> {
    if (workspaceId === undefined) return;
    try {
      await client.call("workspace.close", { workspace_id: workspaceId }, OkSchema);
    } catch {
      // best-effort, mirroring tmux kill-session
    }
  }

  async function unlinkQuietly(settingsPath: string): Promise<void> {
    try {
      if (existsSync(settingsPath)) await unlink(settingsPath);
    } catch {
      // ignore
    }
  }

  function listSessions(): string[] {
    return [...sessions.keys()];
  }

  function hasSession(claudeUuid: string): { present: boolean; paneRef?: string } {
    const entry = sessions.get(claudeUuid);
    return entry ? { present: true, paneRef: entry.paneId } : { present: false };
  }

  function lookup(claudeUuid: string): HerdrSessionEntry | undefined {
    return sessions.get(claudeUuid);
  }

  /** Pane lookup seam for send routing. */
  function resolvePane(claudeUuid: string): string | undefined {
    return sessions.get(claudeUuid)?.paneId;
  }

  async function teardown(claudeUuid: string): Promise<{ killed: boolean }> {
    const entry = sessions.get(claudeUuid);
    if (!entry) {
      return { killed: false };
    }

    await closeWorkspaceQuietly(entry.workspaceId);
    await unlinkQuietly(entry.settingsPath);

    sessions.delete(claudeUuid);
    return { killed: true };
  }

  async function teardownAll(): Promise<void> {
    for (const claudeUuid of [...sessions.keys()]) {
      await teardown(claudeUuid);
    }
  }

  return {
    createSession,
    listSessions,
    hasSession,
    lookup,
    resolvePane,
    teardown,
    teardownAll,
  };
}

export type HerdrRegistry = ReturnType<typeof createHerdrRegistry>;
