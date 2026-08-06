/**
 * GlobalClaudeSessionListing — every agent pane on the machine, foreign or not,
 * and since #30 whatever kind of agent is running in it.
 *
 * Wire shapes are the ones the 2026-08-02 probe recorded: `agent.list` entries
 * carrying `agent_session {kind:"id", value}`, workspace labels (`ccm-<uuid>`
 * for cc-mobile's own, anything else for the user's), and `pane.process_info`
 * argv.
 */

import { describe, expect, test } from "bun:test";
import { listClaudeSessions, type SessionListingClient } from "./sessions";

const SELF_UUID = "3f2a9b01-1111-4222-8333-444455556666";
const VALUE = "a21273d4-77e6-43dc-b9cb-3647561d1192";

function agentEntry(overrides: Record<string, unknown> = {}) {
  return {
    terminal_id: "t1",
    agent_status: "idle",
    workspace_id: "w3V",
    tab_id: "w3V:t1",
    pane_id: "w3V:p1",
    focused: false,
    revision: 4,
    agent: "claude",
    cwd: "/private/tmp/probe/cwd",
    agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: VALUE },
    ...overrides,
  };
}

function workspace(id: string, label: string) {
  return { workspace_id: id, label };
}

interface FakeOptions {
  agents?: Record<string, unknown>[];
  workspaces?: { workspace_id: string; label: string }[];
  argvByPane?: Record<string, string[]>;
  agentGet?: (target: string) => Promise<Record<string, unknown>>;
  agentListError?: Error;
}

function fakeClient(options: FakeOptions = {}) {
  const agents = options.agents ?? [agentEntry()];
  const calls: string[] = [];

  const client = {
    agentList: async () => {
      calls.push("agent.list");
      if (options.agentListError) throw options.agentListError;
      return agents;
    },
    agentGet: async (target: string) => {
      calls.push(`agent.get:${target}`);
      if (options.agentGet) return options.agentGet(target);
      const match = agents.find((agent) => agent.pane_id === target);
      if (!match) throw new Error("agent_not_found");
      return match;
    },
    sessionSnapshot: async () => {
      calls.push("session.snapshot");
      return {
        version: "0.7.5",
        protocol: 17,
        workspaces: options.workspaces ?? [workspace("w3V", "dev")],
        panes: [],
        agents: [],
      };
    },
    call: async (method: string, params: unknown) => {
      calls.push(method);
      const paneId = (params as { pane_id: string }).pane_id;
      const argv = options.argvByPane?.[paneId] ?? ["claude", "--permission-mode", "default"];
      return {
        type: "pane_process_info",
        process_info: {
          pane_id: paneId,
          foreground_processes: [{ pid: 1, argv0: "claude", argv }],
        },
      };
    },
  } as unknown as SessionListingClient;

  return { client, calls };
}

describe("GlobalClaudeSessionListing", () => {
  test("lists every pane herdr reports, whatever is running in it", async () => {
    // The pre-#30 listing filtered to `agent === "claude"`, which made a pane
    // running anything else invisible to the phone — including one whose kind
    // herdr had simply not detected yet.
    const { client } = fakeClient({
      agents: [
        agentEntry(),
        agentEntry({ pane_id: "w5B:p1", workspace_id: "w5B", agent: "pi" }),
        agentEntry({ pane_id: "w6C:p1", workspace_id: "w6C", agent: "omp" }),
      ],
      workspaces: [workspace("w3V", "dev"), workspace("w5B", "pi"), workspace("w6C", "omp")],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions.map((session) => session.sessionId)).toEqual(["w3V:p1", "w5B:p1", "w6C:p1"]);
  });

  test("flags a claude with no transcript key as unreadable but still drivable", async () => {
    const { client } = fakeClient({
      agents: [
        agentEntry(),
        agentEntry({ pane_id: "w4A:p1", workspace_id: "w4A", agent_session: undefined }),
      ],
      workspaces: [workspace("w3V", "dev"), workspace("w4A", "scratch")],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions[0]?.agentSessionValue).toBe(VALUE);
    expect(sessions[0]?.readable).toBe(true);
    expect(sessions[1]).toMatchObject({
      sessionId: "w4A:p1",
      agentSessionValue: null,
      readable: false,
      drivable: true,
    });
  });

  test("lists a pane whose kind herdr has not detected, unread but drivable", async () => {
    const { client } = fakeClient({
      agents: [agentEntry({ pane_id: "w9:p1", workspace_id: "w9", agent: undefined })],
      workspaces: [workspace("w9", "dev")],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: "w9:p1",
      agentSessionValue: VALUE,
      readable: false,
      drivable: true,
    });
    expect(Object.keys(sessions[0] ?? {})).not.toContain("agent");
  });

  test("an unknown kind never costs a pane its drivability", async () => {
    const { client } = fakeClient({
      agents: [agentEntry({ pane_id: "w7:p1", workspace_id: "w7", agent: "codex" })],
      workspaces: [workspace("w7", "dev")],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    // H4's ruling generalised: a flag discloses, it never locks.
    expect(sessions[0]?.drivable).toBe(true);
  });

  test("an empty agent.list is an empty listing, not an error", async () => {
    const { client } = fakeClient({ agents: [] });

    expect(await listClaudeSessions({ client, warn: () => {} })).toEqual([]);
  });

  test("names the kind herdr detected, verbatim", async () => {
    const { client } = fakeClient({
      agents: [agentEntry(), agentEntry({ pane_id: "w6C:p1", workspace_id: "w6C", agent: "omp" })],
      workspaces: [workspace("w3V", "dev"), workspace("w6C", "omp")],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions[0]?.agent).toBe("claude");
    // Verbatim: herdr's label vocabulary is its own and version-dependent, so
    // nothing here normalises, maps or validates it against a list.
    expect(sessions[1]?.agent).toBe("omp");
  });

  test("prefers the kind the live re-read reports over the listing's", async () => {
    const { client } = fakeClient({
      agents: [agentEntry()],
      agentGet: async (target) => agentEntry({ pane_id: target, agent: "omp" }),
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    // Same rule as the session value: agent.get is the fresher read, and
    // detection can complete between the two calls.
    expect(sessions[0]?.agent).toBe("omp");
  });

  test("says nothing at all when herdr reported no kind", async () => {
    const { client } = fakeClient({
      agents: [agentEntry({ agent: undefined })],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions).toHaveLength(1);
    expect(Object.keys(sessions[0] ?? {})).not.toContain("agent");
  });

  test("an empty kind is not detected, and is never guessed as claude", async () => {
    const { client } = fakeClient({
      agents: [agentEntry({ agent: "" })],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions).toHaveLength(1);
    expect(Object.keys(sessions[0] ?? {})).not.toContain("agent");
  });

  test("marks a session readable only when its kind has a reader and it has a key", async () => {
    const { client } = fakeClient({
      agents: [
        agentEntry(),
        agentEntry({ pane_id: "w4A:p1", workspace_id: "w4A", agent_session: undefined }),
        agentEntry({ pane_id: "w6C:p1", workspace_id: "w6C", agent: "omp" }),
        agentEntry({ pane_id: "w9:p1", workspace_id: "w9", agent: undefined }),
      ],
      workspaces: [
        workspace("w3V", "dev"),
        workspace("w4A", "dev"),
        workspace("w6C", "dev"),
        workspace("w9", "dev"),
      ],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    // claude with a transcript key: the one case cc-mobile can read back.
    expect(sessions[0]?.readable).toBe(true);
    // claude with no key: nothing to open.
    expect(sessions[1]?.readable).toBe(false);
    // A key exists, but no reader is registered for omp (#32) — and the flag
    // costs the pane nothing else: it still takes a prompt.
    expect(sessions[2]).toMatchObject({ readable: false, drivable: true });
    // No kind reported: the reader lookup misses, exactly as an unregistered
    // kind does. There is no branch here that names "undetected".
    expect(sessions[3]?.readable).toBe(false);
  });

  test("omits a pane whose claude has exited and keeps the rest", async () => {
    const { client } = fakeClient({
      agents: [agentEntry(), agentEntry({ pane_id: "w4A:p1", workspace_id: "w4A" })],
      workspaces: [workspace("w3V", "dev"), workspace("w4A", "dev")],
      agentGet: async (target) => {
        if (target === "w3V:p1") throw new Error("agent_not_found");
        return agentEntry({ pane_id: target, workspace_id: "w4A" });
      },
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions.map((session) => session.sessionId)).toEqual(["w4A:p1"]);
  });

  test("hides the live-e2e suites' own workspaces", async () => {
    const { client } = fakeClient({
      agents: [agentEntry(), agentEntry({ pane_id: "w9:p1", workspace_id: "w9" })],
      workspaces: [workspace("w3V", "dev"), workspace("w9", "ccme2e-3")],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions.map((session) => session.sessionId)).toEqual(["w3V:p1"]);
  });

  test("an e2e suite can switch the suppression off to see its own pane", async () => {
    const { client } = fakeClient({
      agents: [agentEntry({ pane_id: "w9:p1", workspace_id: "w9" })],
      workspaces: [workspace("w9", "ccme2e-3")],
    });

    const sessions = await listClaudeSessions({
      client,
      suppressLabel: () => false,
      warn: () => {},
    });

    expect(sessions.map((session) => session.sessionId)).toEqual(["w9:p1"]);
  });

  test("flags a bypassPermissions pane as ungated but still drivable", async () => {
    const { client } = fakeClient({
      argvByPane: {
        "w3V:p1": ["claude", "--permission-mode", "bypassPermissions", "--session-id", SELF_UUID],
      },
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions[0]).toMatchObject({ gated: false, drivable: true });
  });

  test("flags a default-mode pane as gated and drivable", async () => {
    const { client } = fakeClient();

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions[0]).toMatchObject({ gated: true, drivable: true });
  });

  test("reads ownership off the workspace label, with no in-process registry", async () => {
    const { client } = fakeClient({ workspaces: [workspace("w3V", `ccm-${SELF_UUID}`)] });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    // Nothing was ever registered in this process — the label alone answers,
    // which is what makes ownership survive a server restart (Decision M12).
    expect(sessions[0]?.origin).toBe("self");
  });

  test("drives a self-launched ungated pane instead of refusing it", async () => {
    const { client } = fakeClient({
      workspaces: [workspace("w3V", `ccm-${SELF_UUID}`)],
      argvByPane: {
        "w3V:p1": ["claude", "--permission-mode", "bypassPermissions", "--session-id", SELF_UUID],
      },
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    // The remount scan used to refuse to adopt exactly this pane; the refusal
    // was deleted with the scan (Decision M12) and survives only as the flag.
    expect(sessions[0]).toMatchObject({ origin: "self", gated: false, drivable: true });
  });

  test("a workspace cc-mobile did not label is foreign", async () => {
    const { client } = fakeClient({ workspaces: [workspace("w3V", "dev")] });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions[0]?.origin).toBe("foreign");
  });

  test("carries what each session is doing right now", async () => {
    const { client } = fakeClient({
      agents: [
        agentEntry({ agent_status: "working" }),
        agentEntry({ pane_id: "w4A:p1", workspace_id: "w4A", agent_status: "blocked" }),
        agentEntry({ pane_id: "w5B:p1", workspace_id: "w5B", agent_status: "hibernating" }),
      ],
      workspaces: [workspace("w3V", "dev"), workspace("w4A", "dev"), workspace("w5B", "dev")],
    });

    const sessions = await listClaudeSessions({ client, warn: () => {} });

    expect(sessions[0]?.state).toBe("running");
    expect(sessions[1]?.state).toBe("requires_action");
    // An unrecognised status is no claim at all, never a guess at "idle".
    expect(sessions[2]?.state).toBeUndefined();
  });

  test("still lists the sessions when process_info is unreadable", async () => {
    const { client } = fakeClient();
    const failing = {
      ...client,
      call: async () => {
        throw new Error("daemon busy");
      },
    } as unknown as SessionListingClient;

    const sessions = await listClaudeSessions({ client: failing, warn: () => {} });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.gated).toBe(true);
  });

  test("answers with an empty list rather than throwing when the daemon is unreachable", async () => {
    const { client } = fakeClient({ agentListError: new Error("socket closed") });
    const warnings: string[] = [];

    const sessions = await listClaudeSessions({ client, warn: (m) => warnings.push(m) });

    expect(sessions).toEqual([]);
    expect(warnings.join(" ")).toContain("agent.list failed");
  });
});
