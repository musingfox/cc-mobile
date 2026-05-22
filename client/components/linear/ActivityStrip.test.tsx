import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ActiveAgent, ActiveTool } from "../../stores/app-store";
import ActivityStrip from "./ActivityStrip";

function mkTool(over: Partial<ActiveTool> = {}): ActiveTool {
  return {
    toolName: "Bash",
    startedAt: Date.now(),
    ...over,
  };
}

function mkAgent(over: Partial<ActiveAgent> = {}): ActiveAgent {
  return {
    description: "find login flow",
    taskType: "Explore",
    status: "running",
    ...over,
  };
}

describe("ActivityStrip", () => {
  afterEach(() => cleanup());

  it("renders nothing when there are no live tools or agents", () => {
    const { container } = render(<ActivityStrip tools={new Map()} agents={new Map()} />);
    expect(container.querySelector(".lin-activity")).toBeNull();
  });

  it("renders orphan tools at top level", () => {
    const tools = new Map<string, ActiveTool>([
      ["t1", mkTool({ toolName: "Read", input: { file_path: "src/App.tsx" } })],
    ]);
    const { container, getByText } = render(<ActivityStrip tools={tools} />);
    expect(container.querySelector(".lin-activity-tool")).not.toBeNull();
    expect(getByText("Read")).toBeTruthy();
    expect(getByText("src/App.tsx")).toBeTruthy();
  });

  it("nests sub-tools under their parent agent and hides them from the orphan list", () => {
    const tools = new Map<string, ActiveTool>([
      ["t1", mkTool({ toolName: "Grep", parentToolUseId: "task-1" })],
      ["t2", mkTool({ toolName: "Read", parentToolUseId: "task-1" })],
      ["t3", mkTool({ toolName: "Edit" })], // orphan, top-level
    ]);
    const agents = new Map<string, ActiveAgent>([["task-id-A", mkAgent({ toolUseId: "task-1" })]]);

    const { container } = render(<ActivityStrip tools={tools} agents={agents} />);

    // agent card present
    expect(container.querySelector(".lin-activity-agent")).not.toBeNull();
    // two nested children
    const nested = container.querySelectorAll(".lin-activity-tool.is-nested");
    expect(nested.length).toBe(2);
    // one orphan at top-level
    const orphans = container.querySelectorAll(
      ".lin-activity > .lin-activity-tool:not(.is-nested)",
    );
    expect(orphans.length).toBe(1);
  });

  it("falls back tools to top-level when their parent agent is unknown", () => {
    const tools = new Map<string, ActiveTool>([
      ["t1", mkTool({ toolName: "Grep", parentToolUseId: "ghost-task" })],
    ]);
    const agents = new Map<string, ActiveAgent>(); // no agent owns 'ghost-task'

    const { container } = render(<ActivityStrip tools={tools} agents={agents} />);
    expect(container.querySelector(".lin-activity-agent")).toBeNull();
    expect(container.querySelectorAll(".lin-activity-tool").length).toBe(1);
  });

  it("hides completed agents but still shows their lingering sub-tools as orphans", () => {
    const tools = new Map<string, ActiveTool>([
      ["t1", mkTool({ toolName: "Grep", parentToolUseId: "task-done" })],
    ]);
    const agents = new Map<string, ActiveAgent>([
      ["agent-done", mkAgent({ toolUseId: "task-done", status: "completed" })],
    ]);

    const { container } = render(<ActivityStrip tools={tools} agents={agents} />);
    expect(container.querySelector(".lin-activity-agent")).toBeNull();
    // since the owning agent isn't in liveAgents, the tool still groups under
    // its parent in subToolsByParent BUT is not rendered. Treat as orphan
    // instead so the user still sees it.
    // This documents current behaviour: completed agents are filtered out,
    // and any tool whose parent agent is no longer running falls back to
    // top-level rendering.
    expect(container.querySelectorAll(".lin-activity-tool").length).toBe(1);
  });

  it("shows agent stats when provided", () => {
    const agents = new Map<string, ActiveAgent>([
      ["task-id-A", mkAgent({ toolUseId: "task-1", toolCount: 7, tokenCount: 2400 })],
    ]);
    const { getByText } = render(<ActivityStrip tools={new Map()} agents={agents} />);
    expect(getByText("7 tools")).toBeTruthy();
    expect(getByText("2.4k tok")).toBeTruthy();
  });
});
