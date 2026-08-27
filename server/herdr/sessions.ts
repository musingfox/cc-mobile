/**
 * sessions.ts — GlobalClaudeSessionListing: every agent pane running on the
 * machine, as the phone sees it.
 *
 * Since #30 that is literally every entry `agent.list` returns, claude or not:
 * the kind rides along as disclosure (`agent`, `readable`) instead of deciding
 * who gets listed. A pane whose kind herdr has not detected yet is listed too —
 * dropping it would hide a session that is about to become identifiable, and a
 * missing kind is an incomplete report, not a claim that nothing is running.
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

import { hasTranscriptReader } from "../agents/transcript-readers";
import { defaultTranscriptFs } from "../transcript/path";
import { type AgentState, STATE_BY_AGENT_STATUS } from "./agent-state";
import { WORKSPACE_LABEL_PATTERN } from "./registry";
import type { AgentInfo, PaneProcess, SessionSnapshot } from "./schema";
import { PaneProcessInfoResultSchema } from "./schema";

/** Workspaces the live-E2E suites label; hidden from the user's session list (Decision M9). */
export const E2E_LABEL_PREFIX = "ccme2e-";

export interface SessionDescriptor {
  /** herdr `pane_id` — the wire session key and every drive RPC's target. */
  sessionId: string;
  /**
   * The workspace holding the pane. Server-side only (the transport projects
   * the wire fields): teardown closes workspaces, and guessing one out of a
   * pane id would be an invariant nobody promised.
   */
  workspaceId: string;
  /**
   * The agent kind herdr detected in that pane, verbatim ("claude", "omp", …).
   * Absent when herdr has not said — an undetected kind, never a default to
   * claude. No enum: the daemon's vocabulary is its own and version-dependent,
   * and a label this build has not heard of must pass through, not fail
   * (same rule as ReportedAgentStatusSchema in schema.ts).
   */
  agent?: string;
  /** The agent's transcript key: `null` on a pane herdr has none for. */
  agentSessionValue: string | null;
  /**
   * What that key *is*, in herdr's words: `"path"` (the file itself — omp and
   * pi) or `"id"` (a name the reader has to locate — claude). Server-side only,
   * like `workspaceId`: it decides which reader logic runs, and the phone has
   * no use for it. Absent when herdr did not say.
   */
  agentSessionKind?: string;
  cwd: string;
  /** "self" iff the workspace carries cc-mobile's `ccm-<uuid>` label. */
  /**
   * The pane's own title as herdr reports it (`terminal_title_stripped`).
   * Absent when herdr has none — never substituted, so a client can say
   * "untitled" instead of inventing a name for a pane.
   */
  title?: string;
  origin: "self" | "foreign";
  /** Whether a prompt may be injected. Never gated on the permission mode (H4). */
  drivable: boolean;
  /**
   * Whether replies can be read back: there is a transcript key, this kind has
   * a registered reader, and — when the key is a path — the file is actually
   * there. Disclosure only, exactly like `gated`: nothing refuses to drive,
   * read or ask permission because it is false.
   */
  readable: boolean;
  /**
   * Why `readable` is false, absent whenever it is true.
   *
   * `readable` alone cannot separate the two, and a screen with nothing on it
   * has to say opposite things about them: `"pending"` is an omp whose first
   * turn has not written the file yet, where typing is what fixes it, while
   * `"unsupported"` is a pane this build has no way to read back at all — no
   * key, or no reader for the kind. `"unsupported"` is still a statement about
   * now, not forever: an undetected kind lands there and leaves it as soon as
   * herdr reports one.
   */
  unreadableReason?: UnreadableReason;
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
  /** fs seam for the path-kind readability check; must not reject. */
  exists?: (path: string) => Promise<boolean>;
}

/**
 * The `--permission-mode <mode>` a process was launched with, if any. Both
 * spellings are read: a pane created before this code existed is an argv we
 * never observed, so the `=` form must not slip through as "no mode". An absent
 * flag means claude's own default, which is gated.
 */
export function permissionModeFromArgv(process: PaneProcess): string | undefined {
  return flagValue(process.argv, "--permission-mode");
}

/**
 * omp's equivalent, which spells the flag differently and takes
 * `always-ask | write | yolo`. Its `--auto-approve` is the same posture as
 * `yolo` and is a bare switch, so it is reported as `yolo` rather than as a
 * value nobody wrote.
 *
 * Needed because omp's default is ungated — verified live 2026-08-06: with no
 * flags at all it wrote a file without asking. So an omp pane carrying no flag
 * is NOT the "asks before it acts" default claude's absent flag means, and
 * `gated` has to say so.
 */
export function approvalModeFromArgv(process: PaneProcess): string | undefined {
  if (process.argv?.includes("--auto-approve")) return "yolo";
  return flagValue(process.argv, "--approval-mode");
}

/** Last occurrence of `--flag value` or `--flag=value`, whichever came later. */
function flagValue(argv: string[] | null | undefined, flag: string): string | undefined {
  if (!argv) return undefined;
  const inlineIndex = argv.findLastIndex((arg) => arg.startsWith(`${flag}=`));
  const flagIndex = argv.lastIndexOf(flag);
  if (inlineIndex > flagIndex) return argv[inlineIndex]?.slice(flag.length + 1);
  if (flagIndex === -1) return undefined;
  return argv[flagIndex + 1];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The kind herdr reported, or `undefined` when it reported none. An empty
 * string is the daemon saying "not detected", so it is not a kind either —
 * carrying `agent: ""` on the wire would be a claim nobody made.
 */
function reportedKind(value: string | null | undefined): string | undefined {
  return value ? value : undefined;
}

/**
 * The pane title herdr reported, or `undefined` when it reported none. Same
 * rule as the kind, plus a trim: a pane whose title is whitespace has no title
 * to show, and passing one on would render as a blank row the user cannot
 * tell apart from a bug.
 */
function reportedTitle(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Why a pane's replies cannot be read back; `undefined` means they can. */
export type UnreadableReason = "pending" | "unsupported";

/**
 * Why this pane's replies cannot be read back right now — `undefined` when
 * they can, which is what `readable` is derived from.
 *
 * Deliberately asymmetric on the last check. A `path` key names the file
 * directly, so one `access()` answers "does the conversation exist yet" — and
 * it has to be asked: omp reports its path the moment it launches and only
 * writes the file when the first turn starts, so without this a brand-new omp
 * would claim to be readable for the ~30s before there is anything to read
 * (#32). An `id` key is claude's, and asking the same question there means the
 * multi-directory scan `resolveTranscriptPath` does, on every listing, for
 * every pane on the machine — for an answer that is effectively always yes,
 * since claude has written the file by the time it has an id.
 *
 * That same asymmetry is why `"pending"` is a `path`-key answer only: it is the
 * one branch that knows the difference between "not written yet" and "not
 * readable", because it is the one branch that looked.
 */
async function unreadableReasonFor(input: {
  kind: string | undefined;
  agentSessionKind: string | undefined;
  agentSessionValue: string | null;
  exists: (path: string) => Promise<boolean>;
}): Promise<UnreadableReason | undefined> {
  const { kind, agentSessionKind, agentSessionValue, exists } = input;
  if (!hasTranscriptReader(kind) || agentSessionValue === null) return "unsupported";
  if (agentSessionKind !== "path") return undefined;
  return (await exists(agentSessionValue)) ? undefined : "pending";
}

/**
 * Every agent pane the daemon knows about, newest listing wins. No kind is
 * filtered out: `agent.list` decides what exists, and this decides nothing.
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
  const exists = options.exists ?? defaultTranscriptFs.exists;

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

  const descriptors = await Promise.all(
    agents.map(async (agent): Promise<SessionDescriptor | null> => {
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
      const agentSessionKind = live.agent_session?.kind ?? agent.agent_session?.kind;
      const state = STATE_BY_AGENT_STATUS[live.agent_status];
      // Live value first, exactly as the session key is taken: `agent.get` is
      // the fresher of the two reads, and detection can complete between them.
      const kind = reportedKind(live.agent) ?? reportedKind(agent.agent);
      // The stripped form: the decorated one carries a spinner glyph, which
      // duplicates `state` and would freeze mid-spin once snapshotted.
      const title =
        reportedTitle(live.terminal_title_stripped) ?? reportedTitle(agent.terminal_title_stripped);
      const unreadableReason = await unreadableReasonFor({
        kind,
        agentSessionKind,
        agentSessionValue,
        exists,
      });

      return {
        sessionId: agent.pane_id,
        workspaceId: agent.workspace_id,
        ...(kind ? { agent: kind } : {}),
        // Live read first, for the same reason the kind is: `agent.get` is the
        // fresher of the two, and a pane retitles itself constantly.
        ...(title ? { title } : {}),
        agentSessionValue,
        ...(agentSessionKind ? { agentSessionKind } : {}),
        cwd: live.cwd ?? live.foreground_cwd ?? cwdByPane.get(agent.pane_id) ?? "",
        origin: WORKSPACE_LABEL_PATTERN.test(label) ? "self" : "foreign",
        // Never gated on the kind: a pane running something cc-mobile cannot
        // read back still takes a prompt, and the H4 ruling is that a flag
        // discloses rather than locks.
        drivable: true,
        // The lookup is the whole rule — an undetected kind falls out of it by
        // missing, with no branch of its own. `readable` is derived from the
        // reason rather than computed beside it, so the two can never disagree.
        readable: unreadableReason === undefined,
        ...(unreadableReason ? { unreadableReason } : {}),
        gated: await readGatedFlag(client, agent.pane_id, kind, warn),
        ...(state ? { state } : {}),
      };
    }),
  );

  return descriptors.filter((descriptor): descriptor is SessionDescriptor => descriptor !== null);
}

/**
 * Whether the agent in this pane still asks before it acts. An argv the daemon
 * cannot read answers "gated": claiming a pane is ungated on no evidence would
 * put a warning badge on a session that has one.
 *
 * Each kind is read in its own vocabulary (#33). Not merely a second flag name:
 * the defaults point opposite ways. claude with no flag asks; omp with no flag
 * does not (live check 2026-08-06 — a default omp wrote a file without a
 * prompt), so an unflagged omp is ungated and gets the badge that says so.
 */
async function readGatedFlag(
  client: SessionListingClient,
  paneId: string,
  kind: string | undefined,
  warn: (message: string) => void,
): Promise<boolean> {
  try {
    const info = await client.call<{
      process_info: { foreground_processes?: PaneProcess[] | null };
    }>("pane.process_info", { pane_id: paneId }, PaneProcessInfoResultSchema);
    const processes = info.process_info.foreground_processes ?? [];
    if (kind === "omp") {
      // `write` and `always-ask` both stop for something; `yolo` stops for
      // nothing. An omp process with no flag at all runs at its own default,
      // which is ungated.
      return processes.some((process) => {
        const mode = approvalModeFromArgv(process);
        return mode === "write" || mode === "always-ask";
      });
    }
    return !processes.some((process) => permissionModeFromArgv(process) === "bypassPermissions");
  } catch (error) {
    warn(`${paneId}: pane.process_info failed, assuming gated: ${describe(error)}`);
    return true;
  }
}
