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

/**
 * The card has to be honest about what kind of session it is before the user
 * taps into it: whose terminal it belongs to, whether replies can be read back,
 * and whether claude will stop to ask before it acts (Decisions H4, M12, M13).
 */
describe("ProjectDetailScreen session disclosure badges", () => {
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

  function badgeText(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll(".lin-session-badge")).map(
      (n) => n.textContent ?? "",
    );
  }

  test("a session the user opened in their own terminal is marked as such", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w9:p1",
      cwd: "/a",
      origin: "foreign",
      drivable: true,
      readable: true,
      gated: true,
    });

    const { container } = renderScreen("/a");

    expect(badgeText(container)).toEqual(["terminal"]);
  });

  test("an ungated session carries the warning badge and stays tappable", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w4:p1",
      cwd: "/a",
      origin: "self",
      drivable: true,
      readable: true,
      gated: false,
    });

    const { container } = renderScreen("/a");

    expect(badgeText(container)).toEqual(["no permission gate"]);
    expect(container.querySelector(".lin-session-badge.is-warn")).not.toBeNull();
    // Disclosure, not a lock: the row is still a button the user can open.
    expect((container.querySelector(".lin-session-row") as HTMLButtonElement).disabled).toBe(false);
  });

  test("a session with no transcript key says replies cannot be read back", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w7:p1",
      cwd: "/a",
      origin: "foreign",
      drivable: true,
      readable: false,
      gated: true,
    });

    const { container } = renderScreen("/a");

    expect(badgeText(container)).toEqual(["terminal", "no readback"]);
  });

  test("an ordinary cc-mobile session carries no badges at all", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w1:p1",
      cwd: "/a",
      origin: "self",
      drivable: true,
      readable: true,
      gated: true,
    });

    const { container } = renderScreen("/a");

    expect(badgeText(container)).toEqual([]);
  });
});
