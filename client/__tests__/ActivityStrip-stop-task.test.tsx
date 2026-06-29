import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import ActivityStrip from "../components/linear/ActivityStrip";
import type { ActiveAgent } from "../stores/app-store";

function mkAgent(over: Partial<ActiveAgent> = {}): ActiveAgent {
  return {
    description: "search files",
    taskType: "Explore",
    status: "running",
    ...over,
  };
}

describe("ActivityStrip stop button", () => {
  afterEach(() => cleanup());

  test("running agent shows an enabled ✕ button that fires onStopAgent(taskId)", () => {
    const onStopAgent = mock((_taskId: string) => {});
    const agents = new Map<string, ActiveAgent>([["task-A", mkAgent({ toolUseId: "tu-A" })]]);

    const { container } = render(
      <ActivityStrip tools={new Map()} agents={agents} onStopAgent={onStopAgent} />,
    );

    const btn = container.querySelector(
      ".lin-activity-agent-stop",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(false);

    if (btn) fireEvent.click(btn);
    expect(onStopAgent).toHaveBeenCalledTimes(1);
    expect(onStopAgent.mock.calls[0][0]).toBe("task-A");
  });

  test("agent in stopped status is hidden from the strip (no ✕ button)", () => {
    const onStopAgent = mock((_taskId: string) => {});
    const agents = new Map<string, ActiveAgent>([
      ["task-A", mkAgent({ status: "stopped", toolUseId: "tu-A" })],
    ]);

    const { container } = render(
      <ActivityStrip tools={new Map()} agents={agents} onStopAgent={onStopAgent} />,
    );

    expect(container.querySelector(".lin-activity-agent-stop")).toBeNull();
  });
});
