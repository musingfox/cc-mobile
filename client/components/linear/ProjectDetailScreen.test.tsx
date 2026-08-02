import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { useAppStore } from "../../stores/app-store";
import ProjectDetailScreen from "./ProjectDetailScreen";

function renderScreen(cwd: string) {
  return render(<ProjectDetailScreen cwd={cwd} onNavigate={() => {}} onBack={() => {}} />);
}

describe("ProjectDetailScreen shows only live sessions", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      connectionState: "connected",
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test("a running session in this project reads Live", () => {
    const store = useAppStore.getState();
    store.addSession("u1", "/a");
    store.setAgentState("u1", "running");
    store.addSession("u2", "/b");

    const { container } = renderScreen("/a");

    const badges = Array.from(container.querySelectorAll(".lin-session-live")).map(
      (n) => n.textContent,
    );
    expect(badges.length).toBe(1);
    expect(badges[0]).toContain("Live");
  });

  test("an idle session in this project reads Active", () => {
    const store = useAppStore.getState();
    store.addSession("u1", "/a");
    store.setAgentState("u1", "idle");

    const { container } = renderScreen("/a");

    const badges = Array.from(container.querySelectorAll(".lin-session-live")).map(
      (n) => n.textContent,
    );
    expect(badges.length).toBe(1);
    expect(badges[0]).toContain("Active");
  });

  test("a project with no live session shows the empty copy", () => {
    const { container, getByText } = renderScreen("/a");

    expect(container.querySelectorAll(".lin-session-row").length).toBe(0);
    expect(getByText("No sessions for this project yet.")).not.toBeNull();
  });

  test("no row carries a rename affordance any more", () => {
    const store = useAppStore.getState();
    store.addSession("u1", "/a");
    store.setAgentState("u1", "idle");

    const { queryAllByLabelText } = renderScreen("/a");

    expect(queryAllByLabelText("Rename session").length).toBe(0);
  });
});
