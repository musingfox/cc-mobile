/**
 * agent-state.ts — the uuid → agent-state join.
 *
 * The status subscription (status-events.ts) is edge-triggered: it only speaks
 * when a pane's status *changes*, so a client that reloads mid-session learns
 * nothing until the next transition. This module is the level-triggered half —
 * one `session.snapshot` answers "what is every live session doing right now",
 * which is what the first paint after a reload needs.
 *
 * Pure by construction: the RPC and the registry lookup are supplied by the
 * caller (backend.ts), so every mapping rule below is testable without a daemon.
 */

import type { SessionSnapshot } from "./schema";

/** The client-facing `session_state` enum. */
export type AgentState = "idle" | "running" | "requires_action";

/**
 * herdr agent_status → the client's session_state enum; `unknown` is dropped.
 * Shared with status-events.ts so the snapshot and the event stream can never
 * disagree about what a status means.
 */
export const STATE_BY_AGENT_STATUS: Record<string, AgentState | undefined> = {
  working: "running",
  blocked: "requires_action",
  idle: "idle",
  // End-of-turn is `done`, not `idle` — both mean "not busy" to the UI.
  done: "idle",
};

/**
 * Resolves each live uuid's agent state from one snapshot.
 *
 * Two carriers are read from the same response because it is not settled which
 * one an *adopted* pane populates: the pane record wins, the matching agent
 * record (joined on pane_id) is the fallback. A uuid whose status is missing,
 * `unknown`, or whose pane is absent from the snapshot is omitted rather than
 * guessed — a missing key reads as "no claim", never as "idle".
 */
export function statesFromSnapshot(
  snapshot: Pick<SessionSnapshot, "panes" | "agents">,
  resolvePane: (claudeUuid: string) => string | undefined,
  liveUuids: readonly string[],
): Record<string, AgentState> {
  const statusByPane = new Map<string, string>();

  for (const pane of snapshot.panes ?? []) {
    const status = (pane as { agent_status?: unknown }).agent_status;
    if (typeof status === "string") statusByPane.set(pane.pane_id, status);
  }
  for (const agent of snapshot.agents ?? []) {
    // Pane record wins: it is the record the daemon updates in place.
    if (statusByPane.has(agent.pane_id)) continue;
    if (typeof agent.agent_status === "string") {
      statusByPane.set(agent.pane_id, agent.agent_status);
    }
  }

  const states: Record<string, AgentState> = {};
  for (const claudeUuid of liveUuids) {
    const paneId = resolvePane(claudeUuid);
    if (!paneId) continue;
    const status = statusByPane.get(paneId);
    const state = status ? STATE_BY_AGENT_STATUS[status] : undefined;
    if (state) states[claudeUuid] = state;
  }
  return states;
}
