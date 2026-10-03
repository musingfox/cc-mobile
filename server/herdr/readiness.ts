/**
 * readiness.ts — HerdrReadinessGate: "the claude composer accepts input".
 *
 * `agent.start` is asynchronous — it returns in ~1ms with `launch_pending:true`
 * while the TUI is still coming up. No subscription event carries readiness
 * (`pane.agent_status_changed` reaches `idle` at ~650ms, well before the input
 * box exists), and `agent.wait` matches stale settled states, so polling
 * `agent.get` for `interactive_ready` is the only honest signal. Live probe
 * 2026-08-01: ready at ~3.1s, agent detection lags launch by ~650ms.
 *
 * Caveat carried from that probe (plan D5): in a cwd claude does not yet trust,
 * `interactive_ready` still goes true while the folder-trust dialog holds the
 * pane — this gate cannot detect that case.
 */

import { HerdrRpcError } from "./errors";

/** The `agent.get` slice this gate needs; the real client's agentGet satisfies it. */
export type AgentGetFn = (target: string) => Promise<{ interactive_ready?: boolean }>;

export interface WaitForInteractiveReadyOptions {
  agentGet: AgentGetFn;
  /** herdr pane id, used as the agent.get target. */
  paneId: string;
  /** Total time to wait before giving up (default 30s). */
  budgetMs?: number;
  /** Delay between polls (default 300ms). */
  pollMs?: number;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_READINESS_BUDGET_MS = 30_000;
export const DEFAULT_READINESS_POLL_MS = 300;

/** The `pane.process_info` fields the shell gate reads; all nullable on the wire. */
export type PaneProcessInfoFn = (paneId: string) => Promise<{
  shell_pid?: number | null;
  foreground_process_group_id?: number | null;
  foreground_processes?: { pid?: number }[] | null;
}>;

export interface WaitForAvailableShellOptions {
  processInfo: PaneProcessInfoFn;
  paneId: string;
  budgetMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_SHELL_BUDGET_MS = 10_000;
export const DEFAULT_SHELL_POLL_MS = 100;

/**
 * Resolves once the pane's shell owns its terminal — the precondition
 * `agent.start` checks, refusing with `agent_pane_busy` ("is not an available
 * shell") when it does not hold. `workspace.create` returns as soon as the pane
 * exists, while the user's shell may still be running its rc files in the
 * foreground, so starting the agent straight after it loses that race now and
 * then (audit 2026-10-03: one create in two).
 *
 * The predicate is herdr's own, read off the fields `pane.process_info`
 * exposes: herdr 0.9.3 `src/platform/mod.rs` `available_pane_shell_from_job`
 * accepts a pane whose foreground process group is the shell's pid and holds
 * no other process. A pid or group herdr cannot read yet is "not yet".
 */
export async function waitForAvailableShell(options: WaitForAvailableShellOptions): Promise<void> {
  const {
    processInfo,
    paneId,
    budgetMs = DEFAULT_SHELL_BUDGET_MS,
    pollMs = DEFAULT_SHELL_POLL_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;

  const deadline = now() + budgetMs;

  while (true) {
    const info = await processInfo(paneId);
    const shell = info.shell_pid;
    const foreground = info.foreground_processes ?? [];
    // An empty foreground is a pane herdr has not read yet, not an idle shell:
    // measured 2026-10-03, a fresh fish pane's first sample can precede the
    // rc child (fzf) that then makes agent.start refuse.
    if (
      typeof shell === "number" &&
      info.foreground_process_group_id === shell &&
      foreground.length > 0 &&
      foreground.every((process) => process.pid === shell)
    ) {
      return;
    }

    if (now() >= deadline) {
      throw new Error(`herdr pane ${paneId} did not reach its shell prompt within ${budgetMs}ms`);
    }
    await sleep(pollMs);
  }
}

/**
 * Resolves once the pane's agent reports `interactive_ready`. Rejects when the
 * budget runs out, or immediately on any RPC error other than
 * `agent_not_found` (which just means detection has not caught up yet).
 */
export async function waitForInteractiveReady(
  options: WaitForInteractiveReadyOptions,
): Promise<void> {
  const {
    agentGet,
    paneId,
    budgetMs = DEFAULT_READINESS_BUDGET_MS,
    pollMs = DEFAULT_READINESS_POLL_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;

  const deadline = now() + budgetMs;

  while (true) {
    try {
      const agent = await agentGet(paneId);
      if (agent.interactive_ready === true) return;
    } catch (error) {
      // The agent is detected ~650ms after launch; until then agent.get says
      // agent_not_found. Any other code is a real failure and must surface.
      if (!(error instanceof HerdrRpcError && error.code === "agent_not_found")) {
        throw error;
      }
    }

    if (now() >= deadline) {
      throw new Error(`herdr pane ${paneId} did not reach interactive_ready within ${budgetMs}ms`);
    }
    await sleep(pollMs);
  }
}
