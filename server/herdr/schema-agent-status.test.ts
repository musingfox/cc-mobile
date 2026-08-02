/**
 * schema-agent-status.test.ts — agent_status parses leniently.
 *
 * `session.snapshot` is what the startup remount reads, and a snapshot that
 * fails to parse aborts the remount, which index.ts treats as fatal. So a herdr
 * release that adds a status value must degrade to "no claim" here, never take
 * the whole snapshot — and with it the boot — down with it.
 */

import { describe, expect, test } from "bun:test";
import { statesFromSnapshot } from "./agent-state";
import { SessionSnapshotResultSchema } from "./schema";

/** Both carriers report the new value: the daemon updates them from one fact. */
function snapshotWithStatus(paneStatus: unknown, agentStatus: unknown) {
  return {
    type: "session_snapshot",
    snapshot: {
      version: "0.9.0",
      protocol: 18,
      workspaces: [{ workspace_id: "w1", label: "ccm-abcd" }],
      panes: [
        { pane_id: "p1", workspace_id: "w1", agent: "claude", agent_status: paneStatus },
        { pane_id: "p2", workspace_id: "w1", agent: "claude", agent_status: "working" },
      ],
      agents: [
        {
          terminal_id: "t1",
          agent_status: agentStatus,
          workspace_id: "w1",
          tab_id: "w1:t1",
          pane_id: "p1",
          focused: false,
          revision: 1,
        },
      ],
    },
  };
}

describe("agent_status tolerance", () => {
  test("a status value this build never heard of still parses the whole snapshot", () => {
    const result = SessionSnapshotResultSchema.safeParse(
      snapshotWithStatus("compacting", "compacting"),
    );

    expect(result.success).toBe(true);
    const snapshot = result.data?.snapshot;
    // Carried through verbatim on both carriers: the parse does not judge the
    // vocabulary, the state lookup does (next case).
    expect(snapshot?.panes[0]?.agent_status).toBe("compacting");
    expect(snapshot?.agents[0]?.agent_status).toBe("compacting");
    // Scoped degradation: the sibling pane keeps its real status.
    expect(snapshot?.panes[1]?.agent_status).toBe("working");
  });

  test("tolerance covers new vocabulary, not a missing field", () => {
    // An absent agent_status stays a shape violation (client.test.ts T3): the
    // daemon promises the field, and silently inventing one would hide a real
    // wire break. Only unrecognised *values* are absorbed.
    const payload = snapshotWithStatus("idle", "idle") as {
      snapshot: { agents: Record<string, unknown>[] };
    };
    delete payload.snapshot.agents[0]?.agent_status;

    expect(SessionSnapshotResultSchema.safeParse(payload).success).toBe(false);
  });

  test("the unknown value costs that session its dot, nothing else", () => {
    const snapshot = SessionSnapshotResultSchema.parse(
      snapshotWithStatus("compacting", "compacting"),
    ).snapshot;

    const states = statesFromSnapshot(snapshot, (uuid) => (uuid === "u1" ? "p1" : "p2"), [
      "u1",
      "u2",
    ]);

    // No key for u1 — a status nobody understands is never guessed as idle.
    expect(states).toEqual({ u2: "running" });
  });

  test("known values are unaffected", () => {
    const snapshot = SessionSnapshotResultSchema.parse(
      snapshotWithStatus("blocked", "idle"),
    ).snapshot;

    expect(snapshot.panes[0]?.agent_status).toBe("blocked");
    expect(statesFromSnapshot(snapshot, () => "p1", ["u1"])).toEqual({ u1: "requires_action" });
  });
});
