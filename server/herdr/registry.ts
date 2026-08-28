/**
 * registry.ts — HerdrCreateSession + HerdrTeardown: cc-mobile-owned agent
 * sessions living in herdr workspaces. Since #31 the kind is the caller's
 * choice (claude by default); its flags come from `argvFor` below.
 *
 * Lifecycle contract: a plain agent argv, duplicate-uuid rejection. Launch is
 * herdr's two-step: `workspace.create` for a pane at a shell prompt, then
 * `agent.start` into that pane. The daemon assembles argv itself and passes
 * `args` through verbatim.
 *
 * Since #29 a session cc-mobile starts is an ORDINARY claude: no `--settings`,
 * no settings file, no hooks. Replies are read from the transcript and
 * permissions are answered through the pane, which is what a session the user
 * started in their own terminal already needed — so the two kinds of session
 * stopped differing (Decision M6). `--session-id` stays: it costs nothing and
 * names the transcript immediately, though nothing may treat it as permanent
 * (a `/clear` rotates it).
 */

import type { ZodType } from "zod";
import { z } from "zod";
import { DEFAULT_AGENT_KIND, type LaunchableAgentKind } from "../agents/kinds";
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

// Live wire fact (probe 2026-08-01): agent.start acks with type:"agent_started",
// not "ok" — validating it as OkSchema kills every createSession.
const AgentStartedResultSchema = z.object({ type: z.literal("agent_started") }).passthrough();

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
}

export interface HerdrRegistryOptions {
  client: HerdrRegistryClient;
  /** Readiness gate tuning + test seams. */
  readinessBudgetMs?: number;
  readinessPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CreateSessionInput {
  claudeUuid: string;
  cwd: string;
  /** Which agent to launch; absent means claude (#31). */
  agentKind?: LaunchableAgentKind;
  /** Operator-configured argv appended after cc-mobile's required flags. */
  profileArgs?: string[];
}

export interface HerdrCreateSessionResult {
  /** herdr agent name — also the desktop attach target (`herdr agent attach <name>`). */
  agentName: string;
  paneId: string;
}

/**
 * herdr agent names are 1-32 chars matching `[a-z][a-z0-9_-]*`, so the full
 * uuid (40 chars with the prefix) is rejected. The uuid↔pane mapping lives in
 * this registry instead of in the daemon's name field.
 */
export function agentNameFor(claudeUuid: string): string {
  return `ccm-${claudeUuid.slice(0, 8).toLowerCase()}`;
}

/**
 * Workspace label — unlike the agent name this carries the FULL uuid, because
 * it is the persistence key: the registry Map dies with the process, so a
 * restart rediscovers its sessions by reading these labels back out of the
 * daemon's snapshot (plan D1). 40 chars, verified round-trip on live herdr.
 */
export function workspaceLabelFor(claudeUuid: string): string {
  return `ccm-${claudeUuid.toLowerCase()}`;
}

/**
 * Full-uuid labels only. Panes created before this format (`ccm-<uuid8>`) do
 * not match and are therefore neither adopted nor reaped — the restart scan
 * leaves anything it cannot identify with certainty alone.
 */
export const WORKSPACE_LABEL_PATTERN =
  /^ccm-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Inverse of `workspaceLabelFor`; undefined for any label this server did not write. */
export function claudeUuidFromWorkspaceLabel(label: string): string | undefined {
  return WORKSPACE_LABEL_PATTERN.exec(label)?.[1];
}

export function createHerdrRegistry(options: HerdrRegistryOptions) {
  const { client } = options;

  const sessions = new Map<string, HerdrSessionEntry>();

  /**
   * The flags each kind is launched with — which is now as close to none as the
   * kind allows.
   *
   * No gating flag for anybody. cc-mobile used to pass claude
   * `--permission-mode`, which meant it decided the safety posture of a session
   * the user would then share with their own terminal. It no longer does: each
   * agent runs at whatever its own settings say, the same way it would if the
   * user had started it themselves. That also makes the two kinds symmetric —
   * omp never took a flag here, and the asymmetry was the tell.
   *
   * `--session-id` stays, and is claude-only for a reason unrelated to
   * settings: it names the transcript immediately (nothing may treat it as
   * permanent — a `/clear` rotates it), and omp is handed its transcript path
   * by herdr instead. Live probe 2026-08-06: `agent.start {kind:"omp",
   * args:[]}` acks with `argv:["omp"]`.
   */
  function argvFor(
    kind: LaunchableAgentKind,
    claudeUuid: string,
    profileArgs: string[] = [],
  ): string[] {
    if (kind !== "claude") return profileArgs;
    return ["--session-id", claudeUuid, ...profileArgs];
  }

  async function createSession(input: CreateSessionInput): Promise<HerdrCreateSessionResult> {
    const { claudeUuid, cwd } = input;
    const agentKind = input.agentKind ?? DEFAULT_AGENT_KIND;

    if (sessions.has(claudeUuid)) {
      throw new Error(`already registered: ${claudeUuid}`);
    }

    const agentName = agentNameFor(claudeUuid);

    let workspaceId: string | undefined;
    try {
      // Caller (terminal-control) has already checked that cwd exists — required,
      // because workspace.create silently falls back to $HOME otherwise.
      const created = await client.call(
        "workspace.create",
        { label: workspaceLabelFor(claudeUuid), cwd, focus: false },
        WorkspaceCreatedResultSchema,
      );
      workspaceId = created.workspace.workspace_id;
      const paneId = created.root_pane.pane_id;

      // argv is passed through verbatim by the daemon.
      await client.call(
        "agent.start",
        {
          name: agentName,
          kind: agentKind,
          pane_id: paneId,
          args: argvFor(agentKind, claudeUuid, input.profileArgs),
        },
        AgentStartedResultSchema,
      );

      await waitForInteractiveReady({
        agentGet: client.agentGet,
        paneId,
        budgetMs: options.readinessBudgetMs,
        pollMs: options.readinessPollMs,
        sleep: options.sleep,
        now: options.now,
      });

      sessions.set(claudeUuid, { workspaceId, paneId, agentName });
      return { agentName, paneId };
    } catch (error) {
      // Leave nothing half-created: the pane (and the claude in it) would
      // otherwise outlive a failed create with no uuid mapping to reach it.
      await closeWorkspaceQuietly(workspaceId);
      throw error;
    }
  }

  /**
   * Registers a session this process did not create — a pane that survived a
   * restart and has been verified to still hold a live claude. Everything
   * `createSession` would have recorded is either read from the daemon snapshot
   * or rebuilt by formula, so no RPC is issued here.
   *
   * Rejects a duplicate uuid exactly as `createSession` does: two workspaces
   * claiming one uuid is an ambiguity to report, not to silently resolve.
   */
  function adoptSession(entry: HerdrSessionEntry & { claudeUuid: string }): void {
    const { claudeUuid, ...rest } = entry;
    if (sessions.has(claudeUuid)) {
      throw new Error(`already registered: ${claudeUuid}`);
    }
    sessions.set(claudeUuid, rest);
  }

  async function closeWorkspaceQuietly(workspaceId: string | undefined): Promise<void> {
    if (workspaceId === undefined) return;
    try {
      await client.call("workspace.close", { workspace_id: workspaceId }, OkSchema);
    } catch {
      // best-effort: killing an already-dead pane is not an error
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
    adoptSession,
    listSessions,
    hasSession,
    lookup,
    resolvePane,
    teardown,
    teardownAll,
  };
}

export type HerdrRegistry = ReturnType<typeof createHerdrRegistry>;
