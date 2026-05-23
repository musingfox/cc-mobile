import { describe, expect, test } from "bun:test";
import { resolveAgentAttribution } from "../services/ws-service";
import type { ActiveAgent, ActiveTool } from "../stores/app-store";

function buildSession(
  tools: Array<[string, Partial<ActiveTool>]> = [],
  agents: Array<[string, Partial<ActiveAgent>]> = [],
) {
  const activeTools = new Map<string, ActiveTool>();
  for (const [id, t] of tools) {
    activeTools.set(id, {
      toolName: "Tool",
      startedAt: 0,
      ...t,
    });
  }
  const activeAgents = new Map<string, ActiveAgent>();
  for (const [id, a] of agents) {
    activeAgents.set(id, {
      description: "",
      status: "running",
      ...a,
    });
  }
  return { activeTools, activeAgents };
}

describe("resolveAgentAttribution", () => {
  test("empty preceding ids + empty maps → null", () => {
    expect(resolveAgentAttribution(buildSession(), [])).toBeNull();
  });

  test("preceding id t1 with parentToolUseId=null, no agents → null", () => {
    const session = buildSession([["t1", { parentToolUseId: null }]]);
    expect(resolveAgentAttribution(session, ["t1"])).toBeNull();
  });

  test("preceding t1 → parent task-tu-7 matches agent → returns label+description", () => {
    const session = buildSession(
      [["t1", { parentToolUseId: "task-tu-7" }]],
      [["task-1", { toolUseId: "task-tu-7", taskType: "explore", description: "investigate bug" }]],
    );
    expect(resolveAgentAttribution(session, ["t1"])).toEqual({
      label: "explore",
      description: "investigate bug",
    });
  });

  test("batch [t1,t2]: t1 has no parent, t2 matches an agent → returns matched attribution", () => {
    const session = buildSession(
      [
        ["t1", { parentToolUseId: null }],
        ["t2", { parentToolUseId: "task-tu-9" }],
      ],
      [["task-2", { toolUseId: "task-tu-9", taskType: "research", description: "look up docs" }]],
    );
    expect(resolveAgentAttribution(session, ["t1", "t2"])).toEqual({
      label: "research",
      description: "look up docs",
    });
  });

  test("parent set but activeAgents empty (late summary) → null", () => {
    const session = buildSession([["t1", { parentToolUseId: "task-tu-7" }]], []);
    expect(resolveAgentAttribution(session, ["t1"])).toBeNull();
  });

  test("agent matches but missing taskType → label='Agent', description preserved", () => {
    const session = buildSession(
      [["t1", { parentToolUseId: "task-tu-7" }]],
      [["task-1", { toolUseId: "task-tu-7", description: "investigate bug" }]],
    );
    expect(resolveAgentAttribution(session, ["t1"])).toEqual({
      label: "Agent",
      description: "investigate bug",
    });
  });

  test("preceding id missing from activeTools, empty activeTools → null", () => {
    const session = buildSession();
    expect(resolveAgentAttribution(session, ["missing"])).toBeNull();
  });
});
