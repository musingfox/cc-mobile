/**
 * sessions.ts — GlobalClaudeSessionListing: every claude running on the
 * machine, as the phone sees it.
 *
 * This replaces the startup remount scan (Decision M12). The scan existed to
 * rebuild an in-memory uuid→pane map from workspace labels; there is no such
 * map any more, so the daemon is queried live instead and `agent.list` — not
 * cc-mobile's own labels — decides what exists. A session the user started in
 * their own terminal is therefore listed, readable and drivable exactly like
 * one cc-mobile launched (Decision H1).
 *
 * The workspace label keeps one job and loses the other: it is still the
 * ownership marker (`origin: "self"`, which teardown gates on), and it is no
 * longer a discovery mechanism.
 *
 * `gated` is advisory disclosure, never a restriction: a pane launched with
 * `--permission-mode bypassPermissions` raises no prompt for cc-mobile to
 * intercept, and the human gate ruled such panes drivable with a warning rather
 * than refused (Decision H4). Nothing here may set `drivable: false` because of
 * it.
 */

import { type AgentState, STATE_BY_AGENT_STATUS } from "./agent-state";
import { WORKSPACE_LABEL_PATTERN } from "./registry";
import type { AgentInfo, PaneProcess, SessionSnapshot } from "./schema";
import { PaneProcessInfoResultSchema } from "./schema";

/** Workspaces the live-E2E suites label; hidden from the user's session list (Decision M9). */
export const E2E_LABEL_PREFIX = "ccme2e-";

export interface SessionDescriptor {
  /** herdr `pane_id` — the wire session key and every drive RPC's target. */
  sessionId: string;
  /** claude session uuid: the transcript key, `null` on a pane herdr has none for. */
  agentSessionValue: string | null;
  cwd: string;
  /** "self" iff the workspace carries cc-mobile's `ccm-<uuid>` label. */
  origin: "self" | "foreign";
  /** Whether a prompt may be injected. Never gated on the permission mode (H4). */
  drivable: boolean;
  /** Whether replies can be read back — false when there is no transcript key. */
  readable: boolean;
  /** Advisory: false means claude runs with no permission gate in that pane. */
  gated: boolean;
  state?: AgentState;
}

/** The client slice the listing needs; the real HerdrClient satisfies it. */
export interface SessionListingClient {
  agentList(): Promise<AgentInfo[]>;
  agentGet(target: string): Promise<AgentInfo>;
  sessionSnapshot(): Promise<SessionSnapshot>;
  call<T = unknown>(method: string, params: unknown, schema?: unknown): Promise<T>;
}

export interface SessionListingOptions {
  client: SessionListingClient;
  /** Injectable so an e2e suite can assert on its own pane (Decision M9). */
  suppressLabel?: (label: string) => boolean;
  warn?: (message: string) => void;
}

/**
 * The `--permission-mode <mode>` a process was launched with, if any. Both
 * spellings are read: a pane created before this code existed is an argv we
 * never observed, so the `=` form must not slip through as "no mode". An absent
 * flag means claude's own default, which is gated.
 */
export function permissionModeFromArgv(process: PaneProcess): string | undefined {
  const argv = process.argv;
  if (!argv) return undefined;
  const inlineIndex = argv.findLastIndex((arg) => arg.startsWith("--permission-mode="));
  const flagIndex = argv.lastIndexOf("--permission-mode");
  if (inlineIndex > flagIndex) return argv[inlineIndex]?.slice("--permission-mode=".length);
  if (flagIndex === -1) return undefined;
  return argv[flagIndex + 1];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every claude the daemon knows about, newest listing wins.
 *
 * Never rejects. One pane that cannot be inspected (its claude exited between
 * the list and the get — herdr answers `agent_not_found`) is omitted; a daemon
 * that cannot be reached at all yields an empty list, which the client already
 * reads as "nothing is running", not as "delete every card".
 */
export async function listClaudeSessions(
  options: SessionListingOptions,
): Promise<SessionDescriptor[]> {
  const { client } = options;
  const suppressLabel =
    options.suppressLabel ?? ((label: string) => label.startsWith(E2E_LABEL_PREFIX));
  const warn = options.warn ?? ((message: string) => console.warn(`[herdr] sessions: ${message}`));

  let agents: AgentInfo[];
  try {
    agents = await client.agentList();
  } catch (error) {
    warn(`agent.list failed: ${describe(error)}`);
    return [];
  }

  // Labels and pane cwds live in the snapshot, not in agent.list. Losing it
  // costs ownership and cwd, not the listing itself.
  let snapshot: SessionSnapshot | undefined;
  try {
    snapshot = await client.sessionSnapshot();
  } catch (error) {
    warn(`session.snapshot failed: ${describe(error)}`);
  }

  const labelByWorkspace = new Map<string, string>();
  for (const workspace of snapshot?.workspaces ?? []) {
    labelByWorkspace.set(workspace.workspace_id, workspace.label);
  }
  const cwdByPane = new Map<string, string>();
  for (const pane of snapshot?.panes ?? []) {
    const cwd = (pane as { cwd?: unknown }).cwd;
    if (typeof cwd === "string") cwdByPane.set(pane.pane_id, cwd);
  }

  const claudes = agents.filter((agent) => agent.agent === "claude");

  const descriptors = await Promise.all(
    claudes.map(async (agent): Promise<SessionDescriptor | null> => {
      const label = labelByWorkspace.get(agent.workspace_id) ?? "";
      if (suppressLabel(label)) return null;

      // Re-read the pane: agent.list can name a claude that has since exited,
      // and this is where the daemon says so (`agent_not_found`).
      let live: AgentInfo;
      try {
        live = await client.agentGet(agent.pane_id);
      } catch (error) {
        warn(`${agent.pane_id} omitted: agent.get failed: ${describe(error)}`);
        return null;
      }

      const agentSessionValue = live.agent_session?.value ?? agent.agent_session?.value ?? null;
      const state = STATE_BY_AGENT_STATUS[live.agent_status];

      return {
        sessionId: agent.pane_id,
        agentSessionValue,
        cwd: live.cwd ?? live.foreground_cwd ?? cwdByPane.get(agent.pane_id) ?? "",
        origin: WORKSPACE_LABEL_PATTERN.test(label) ? "self" : "foreign",
        drivable: true,
        readable: agentSessionValue !== null,
        gated: await readGatedFlag(client, agent.pane_id, warn),
        ...(state ? { state } : {}),
      };
    }),
  );

  return descriptors.filter((descriptor): descriptor is SessionDescriptor => descriptor !== null);
}

/**
 * Whether the claude in this pane still asks before it acts. An argv the daemon
 * cannot read answers "gated": claiming a pane is ungated on no evidence would
 * put a warning badge on a session that has one.
 */
async function readGatedFlag(
  client: SessionListingClient,
  paneId: string,
  warn: (message: string) => void,
): Promise<boolean> {
  try {
    const info = await client.call<{
      process_info: { foreground_processes?: PaneProcess[] | null };
    }>("pane.process_info", { pane_id: paneId }, PaneProcessInfoResultSchema);
    const processes = info.process_info.foreground_processes ?? [];
    return !processes.some((process) => permissionModeFromArgv(process) === "bypassPermissions");
  } catch (error) {
    warn(`${paneId}: pane.process_info failed, assuming gated: ${describe(error)}`);
    return true;
  }
}
