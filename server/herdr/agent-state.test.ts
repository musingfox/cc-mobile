/**
 * agent-state.test.ts — HerdrAgentStateSnapshot.
 *
 * The status subscription only speaks on change, so a client that reloads
 * mid-session used to see nothing until the next transition. These cases pin
 * the level-triggered answer: one snapshot, one state per live uuid, and a
 * missing key wherever the daemon has nothing usable to say.
 */

import { describe, expect, test } from "bun:test";
import { statesFromSnapshot } from "./agent-state";
import { createHerdrBackend, type HerdrBackendOptions } from "./backend";
import type { SessionSnapshot } from "./schema";

const UUID = "3f2a9b01-1111-4222-8333-444455556666";

/** A minimal agent record — only pane_id and agent_status matter to the join. */
function agent(pane_id: string, agent_status: string) {
  return {
    terminal_id: "t1",
    agent_status,
    workspace_id: "w1",
    tab_id: "tab1",
    pane_id,
    focused: false,
    revision: 1,
  } as unknown as SessionSnapshot["agents"][number];
}

function snapshot(
  panes: Array<Record<string, unknown>>,
  agents: Array<Record<string, unknown>> = [],
): Pick<SessionSnapshot, "panes" | "agents"> {
  return {
    panes: panes as unknown as SessionSnapshot["panes"],
    agents: agents as unknown as SessionSnapshot["agents"],
  };
}

const resolveOne = (uuid: string) => (uuid === "u1" ? "p1" : undefined);

describe("statesFromSnapshot — pane status mapping", () => {
  test("a working pane reads as running", () => {
    const states = statesFromSnapshot(
      snapshot([{ pane_id: "p1", workspace_id: "w1", agent_status: "working" }]),
      resolveOne,
      ["u1"],
    );
    expect(states).toEqual({ u1: "running" });
  });

  test("a blocked pane reads as requires_action", () => {
    const states = statesFromSnapshot(
      snapshot([{ pane_id: "p1", workspace_id: "w1", agent_status: "blocked" }]),
      resolveOne,
      ["u1"],
    );
    expect(states).toEqual({ u1: "requires_action" });
  });

  test("end-of-turn `done` reads as idle, like `idle` itself", () => {
    expect(
      statesFromSnapshot(
        snapshot([{ pane_id: "p1", workspace_id: "w1", agent_status: "done" }]),
        resolveOne,
        ["u1"],
      ),
    ).toEqual({ u1: "idle" });
    expect(
      statesFromSnapshot(
        snapshot([{ pane_id: "p1", workspace_id: "w1", agent_status: "idle" }]),
        resolveOne,
        ["u1"],
      ),
    ).toEqual({ u1: "idle" });
  });

  test("a pane without a status falls back to the matching agent record", () => {
    // The carrier an adopted pane populates is not settled, so both are read
    // from the same response rather than betting on one.
    const states = statesFromSnapshot(
      snapshot([{ pane_id: "p1", workspace_id: "w1" }], [agent("p1", "working")]),
      resolveOne,
      ["u1"],
    );
    expect(states).toEqual({ u1: "running" });
  });

  test("`unknown` yields no key at all — a missing state is not idle", () => {
    const states = statesFromSnapshot(
      snapshot([{ pane_id: "p1", workspace_id: "w1", agent_status: "unknown" }]),
      resolveOne,
      ["u1"],
    );
    expect(states).toEqual({});
  });

  test("a live uuid with no pane mapping is omitted rather than guessed", () => {
    const states = statesFromSnapshot(
      snapshot([{ pane_id: "p1", workspace_id: "w1", agent_status: "working" }]),
      () => undefined,
      ["u2"],
    );
    expect(states).toEqual({});
    expect(Object.hasOwn(states, "u2")).toBe(false);
  });
});

/** The fake covers only the slice the backend touches. */
function makeClient(overrides: Record<string, unknown>) {
  return {
    call: async (method: string) => {
      if (method === "workspace.create") {
        return {
          type: "workspace_created",
          workspace: { workspace_id: "w1" },
          root_pane: { pane_id: "p1" },
        };
      }
      return { type: "ok" };
    },
    agentGet: async () => ({ interactive_ready: true }),
    paneSendText: async () => {},
    paneSendKeys: async () => {},
    subscribeEvents: async () => ({ stop: () => {} }),
    ...overrides,
  } as unknown as NonNullable<HerdrBackendOptions["client"]>;
}

describe("backend.listStates — one call, never a rejection", () => {
  test("a failing snapshot degrades to an empty map instead of rejecting", async () => {
    const backend = createHerdrBackend({
      client: makeClient({
        sessionSnapshot: async () => {
          throw new Error("socket closed");
        },
      }),
    });

    await expect(backend.listStates()).resolves.toEqual({});
  });

  test("three live sessions still cost exactly one snapshot RPC", async () => {
    let snapshotCalls = 0;
    const panes = [
      { pane_id: "p1", workspace_id: "w1", agent_status: "working" },
      { pane_id: "p2", workspace_id: "w2", agent_status: "blocked" },
      { pane_id: "p3", workspace_id: "w3", agent_status: "done" },
    ];
    let paneCounter = 0;
    const backend = createHerdrBackend({
      client: makeClient({
        call: async (method: string) => {
          if (method === "workspace.create") {
            paneCounter += 1;
            return {
              type: "workspace_created",
              workspace: { workspace_id: `w${paneCounter}` },
              root_pane: { pane_id: `p${paneCounter}` },
            };
          }
          return { type: "ok" };
        },
        sessionSnapshot: async () => {
          snapshotCalls += 1;
          return { workspaces: [], panes, agents: [] };
        },
      }),
    });

    const uuids = [`${UUID.slice(0, -1)}1`, `${UUID.slice(0, -1)}2`, `${UUID.slice(0, -1)}3`];
    for (const claudeUuid of uuids) {
      await backend.createSession({ claudeUuid, cwd: "/tmp" });
    }

    const states = await backend.listStates();

    expect(snapshotCalls).toBe(1);
    expect(states).toEqual({
      [uuids[0]]: "running",
      [uuids[1]]: "requires_action",
      [uuids[2]]: "idle",
    });
  });
});
