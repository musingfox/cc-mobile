/**
 * remount.ts — StartupRemount + OrphanPaneReap: rediscovering cc-mobile's own
 * sessions in the daemon after the server process restarts.
 *
 * The registry's uuid→pane Map lives in memory and dies with the process, but
 * the panes do not (plan D2 removed the shutdown teardown). This scan rebuilds
 * that Map from the daemon's own state: workspace labels carry the full claude
 * uuid (plan D1), so one `session.snapshot` enumerates every candidate, and one
 * `pane.process_info` per candidate decides what to do with it.
 *
 * Three outcomes, and the split between them is deliberately conservative:
 *
 *   adopt — a claude is running in the pane AND its argv carries the same
 *           `--session-id` the label claims. Only then is the session ours and
 *           still alive, so routing can be restored.
 *   reap  — process_info answered and no claude is running there at all. The
 *           conversation lived inside that process, so the pane has nothing
 *           left to recover; close it and drop its settings file.
 *   skip  — anything else: the RPC failed, the pane is ambiguous, or a claude
 *           is alive but is not the one the label names (someone's own
 *           `claude -c` in a workspace we would otherwise have reaped).
 *
 * Reaping is the only destructive branch, so it requires a positive "no claude
 * here" answer — never merely the absence of a matching session-id.
 */

import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { basename } from "node:path";
import type { ZodType } from "zod";
import {
  agentNameFor,
  claudeUuidFromWorkspaceLabel,
  type HerdrSessionEntry,
  settingsPathFor,
} from "./registry";
import type { PaneInfo, PaneProcess } from "./schema";
import { PaneProcessInfoResultSchema, SessionSnapshotResultSchema } from "./schema";

export interface RemountReport {
  /** uuids now routable again: in the registry, with a live status subscription. */
  adopted: string[];
  /** uuids whose pane held no claude; their workspace was closed. */
  reaped: string[];
  /** uuids left exactly as found, with why. */
  skipped: { uuid: string; reason: string }[];
}

export interface RemountDeps {
  /** The same `call` escape hatch the registry uses; the real client satisfies it. */
  client: {
    call<T = unknown>(method: string, params: unknown, schema?: ZodType<T>): Promise<T>;
  };
  /** Registers an adopted session; throws on a uuid that is already registered. */
  adopt(entry: HerdrSessionEntry & { claudeUuid: string }): void;
  /** Restarts the per-session status subscription. Must not reject. */
  subscribeStatus(claudeUuid: string, paneId: string): Promise<void>;
  warn?: (message: string) => void;
}

/** True when this foreground process is a claude, however it was invoked. */
function isClaudeProcess(process: PaneProcess): boolean {
  const names = [process.argv0, process.argv?.[0]];
  return names.some((name) => typeof name === "string" && basename(name) === "claude");
}

/** The `--session-id <uuid>` this process was launched with, if any. */
function sessionIdFromArgv(process: PaneProcess): string | undefined {
  const argv = process.argv;
  if (!argv) return undefined;
  const flagIndex = argv.lastIndexOf("--session-id");
  if (flagIndex === -1) return undefined;
  return argv[flagIndex + 1]?.toLowerCase();
}

/**
 * Picks the pane that would be running claude. A single-pane workspace is
 * unambiguous even when nothing is detected in it (that is the reap case);
 * a split workspace is only unambiguous when exactly one pane holds a claude.
 */
function selectPane(panes: PaneInfo[]): PaneInfo | undefined {
  if (panes.length <= 1) return panes[0];
  const claudePanes = panes.filter((pane) => pane.agent === "claude");
  return claudePanes.length === 1 ? claudePanes[0] : undefined;
}

async function unlinkQuietly(path: string): Promise<void> {
  try {
    if (existsSync(path)) await unlink(path);
  } catch {
    // best-effort, mirroring the registry's teardown
  }
}

/**
 * Scans the daemon once and restores every cc-mobile session still alive.
 *
 * A failing `session.snapshot` rejects: without it there is no way to tell a
 * daemon with no sessions from a daemon we cannot read, and silently starting
 * with an empty registry would strand every live pane. Per-candidate failures
 * never reject — one unreadable pane must not cost the others their remount.
 */
export async function remountLiveSessions(deps: RemountDeps): Promise<RemountReport> {
  const { client, adopt, subscribeStatus } = deps;
  const warn = deps.warn ?? ((message: string) => console.warn(`[herdr] remount: ${message}`));

  const report: RemountReport = { adopted: [], reaped: [], skipped: [] };

  const { snapshot } = await client.call("session.snapshot", {}, SessionSnapshotResultSchema);

  function skip(uuid: string, reason: string): void {
    report.skipped.push({ uuid, reason });
    warn(`${uuid}: ${reason}`);
  }

  for (const workspace of snapshot.workspaces) {
    const claudeUuid = claudeUuidFromWorkspaceLabel(workspace.label);
    // Not ours, or a pre-full-uuid pane we cannot identify: leave it entirely
    // alone — not adopted, and above all not closed.
    if (!claudeUuid) continue;

    const pane = selectPane(
      snapshot.panes.filter((candidate) => candidate.workspace_id === workspace.workspace_id),
    );
    if (!pane) {
      skip(claudeUuid, `no unambiguous pane in workspace ${workspace.workspace_id}`);
      continue;
    }

    let processes: PaneProcess[];
    try {
      const info = await client.call(
        "pane.process_info",
        { pane_id: pane.pane_id },
        PaneProcessInfoResultSchema,
      );
      processes = info.process_info.foreground_processes ?? [];
    } catch (error) {
      skip(claudeUuid, `pane.process_info failed: ${describe(error)}`);
      continue;
    }

    const claudeProcesses = processes.filter(isClaudeProcess);

    if (claudeProcesses.length === 0) {
      await reap(claudeUuid, workspace.workspace_id);
      continue;
    }

    const identified = claudeProcesses.some(
      (process) => sessionIdFromArgv(process) === claudeUuid.toLowerCase(),
    );
    if (!identified) {
      // A claude is alive in there, just not the one this label names. Reaping
      // it would kill someone's live conversation.
      skip(claudeUuid, "a claude is running but its --session-id does not match the label");
      continue;
    }

    try {
      adopt({
        claudeUuid,
        workspaceId: workspace.workspace_id,
        paneId: pane.pane_id,
        agentName: agentNameFor(claudeUuid),
        settingsPath: settingsPathFor(claudeUuid),
      });
    } catch (error) {
      skip(claudeUuid, `not adopted: ${describe(error)}`);
      continue;
    }

    await subscribeStatus(claudeUuid, pane.pane_id);
    report.adopted.push(claudeUuid);
  }

  return report;

  async function reap(claudeUuid: string, workspaceId: string): Promise<void> {
    try {
      await client.call("workspace.close", { workspace_id: workspaceId });
    } catch (error) {
      // Best-effort: a workspace that refuses to close still had its claude
      // die, and the rest of the batch still deserves its remount.
      warn(`${claudeUuid}: workspace.close failed: ${describe(error)}`);
    }
    await unlinkQuietly(settingsPathFor(claudeUuid));
    report.reaped.push(claudeUuid);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
