/**
 * agent-state.ts — the session → agent-state join.
 *
 * The pane event stream is edge-triggered: it only speaks when a pane's status
 * *changes*, so a client that reloads mid-session learns nothing until the next
 * transition. This module is the level-triggered half — one `session.snapshot`
 * answers "what is every live session doing right now", which is what the first
 * paint after a reload needs.
 *
 * Pure by construction: the RPC and the key mapping are supplied by the caller
 * (backend.ts), so every mapping rule below is testable without a daemon.
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
 * Resolves each live session's agent state from one snapshot.
 *
 * Two carriers are read from the same response because it is not settled which
 * one every pane populates: the pane record wins, the matching agent record
 * (joined on pane_id) is the fallback. A session whose status is missing,
 * `unknown`, or whose pane is absent from the snapshot is omitted rather than
 * guessed — a missing key reads as "no claim", never as "idle".
 *
 * `resolvePane` exists because the key on the wire need not be the pane id it
 * looks up; since #29 it usually is (`sessionId` IS the pane id, Decision H5)
 * and the mapping is the identity.
 */
export function statesFromSnapshot(
  snapshot: Pick<SessionSnapshot, "panes" | "agents">,
  resolvePane: (sessionKey: string) => string | undefined,
  liveKeys: readonly string[],
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
  for (const sessionKey of liveKeys) {
    const paneId = resolvePane(sessionKey);
    if (!paneId) continue;
    const status = statusByPane.get(paneId);
    const state = status ? STATE_BY_AGENT_STATUS[status] : undefined;
    if (state) states[sessionKey] = state;
  }
  return states;
}
