import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
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

  test("a session running another agent is marked with that agent's name", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w6C:p1",
      cwd: "/a",
      origin: "foreign",
      drivable: true,
      readable: false,
      gated: true,
      agent: "omp",
    });

    const { container } = renderScreen("/a");

    expect(badgeText(container)).toContain("omp");
  });

  test("the agent badge joins the existing disclosures rather than replacing them", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w6C:p1",
      cwd: "/a",
      origin: "foreign",
      drivable: true,
      readable: false,
      gated: true,
      agent: "omp",
    });

    const { container } = renderScreen("/a");

    expect(badgeText(container)).toEqual(["terminal", "no readback", "omp"]);
  });

  test("a claude session is not singled out with a kind badge", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w1:p1",
      cwd: "/a",
      origin: "self",
      drivable: true,
      readable: true,
      gated: true,
      agent: "claude",
    });

    const { container } = renderScreen("/a");

    expect(badgeText(container)).toEqual([]);
  });

  test("an unlabelled session gets no kind badge and no guessed name", () => {
    // herdr has not worked out what runs there. The card says nothing rather
    // than assuming claude.
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
    expect(container.textContent).not.toContain("unknown");
    expect(container.textContent).not.toContain("claude");
  });
});

/**
 * The new-session footer. The agent choice only exists when the machine has
 * more than one launchable kind — with one, the footer is the single button it
 * has always been.
 */
describe("ProjectDetailScreen new-session footer", () => {
  const created: Array<[string, string | undefined]> = [];
  const originalCreate = wsService.createTerminalSession;

  beforeEach(() => {
    localStorage.clear();
    created.length = 0;
    wsService.createTerminalSession = ((cwd: string, agentKind?: string) => {
      created.push([cwd, agentKind]);
      return "u-new";
    }) as typeof wsService.createTerminalSession;
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      connectionState: "connected",
      availableAgents: [],
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    wsService.createTerminalSession = originalCreate;
    useAppStore.setState({ availableAgents: [] });
  });

  function ctas(container: HTMLElement): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll(".lin-projects-cta"));
  }

  test("one launchable kind keeps the single unchanged button", () => {
    useAppStore.setState({ availableAgents: ["claude"] });

    const { container } = renderScreen("/a");

    const buttons = ctas(container);
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.textContent).toContain("New session in this project");
  });

  test("before server_config arrives the footer is the same single button", () => {
    const { container } = renderScreen("/a");

    expect(ctas(container).length).toBe(1);
  });

  test("two kinds give one button each, naming the kind", () => {
    useAppStore.setState({ availableAgents: ["claude", "omp"] });

    const { container } = renderScreen("/a");

    expect(ctas(container).map((b) => b.textContent)).toEqual([
      "New claude session",
      "New omp session",
    ]);
  });

  test("tapping a kind's button starts that kind", () => {
    useAppStore.setState({ availableAgents: ["claude", "omp"] });

    const { container } = renderScreen("/a");
    ctas(container)[1]?.click();

    expect(created).toEqual([["/a", "omp"]]);
  });

  test("the single button sends no kind at all, so the server's default applies", () => {
    useAppStore.setState({ availableAgents: ["claude"] });

    const { container } = renderScreen("/a");
    ctas(container)[0]?.click();

    expect(created).toEqual([["/a", undefined]]);
  });
});

/**
 * Closing a session. The control was dropped in the Linear redesign (c28f88b)
 * and `wsService.closeSession` sat with no caller from then on; this is that
 * caller. Closing kills the agent in the pane, so the two things worth pinning
 * are that it asks first and that it is not offered where the server would
 * refuse it anyway (Decision M13).
 */
describe("ProjectDetailScreen close control", () => {
  const closed: string[] = [];
  const originalClose = wsService.closeSession;
  const originalConfirm = window.confirm;
  let answer = true;

  beforeEach(() => {
    localStorage.clear();
    closed.length = 0;
    answer = true;
    wsService.closeSession = ((sessionId: string) => {
      closed.push(sessionId);
    }) as typeof wsService.closeSession;
    window.confirm = (() => answer) as typeof window.confirm;
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      connectionState: "connected",
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    wsService.closeSession = originalClose;
    window.confirm = originalConfirm;
  });

  function closeButtons(container: HTMLElement): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll(".lin-session-close"));
  }

  test("a session cc-mobile owns can be closed from its row", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w1:p1",
      cwd: "/a",
      origin: "self",
      drivable: true,
      readable: true,
      gated: true,
    });

    const { container } = renderScreen("/a");
    const buttons = closeButtons(container);
    expect(buttons.length).toBe(1);
    buttons[0]?.click();

    expect(closed).toEqual(["w1:p1"]);
  });

  test("declining the confirmation closes nothing", () => {
    answer = false;
    useAppStore.getState().upsertListedSession({
      sessionId: "w1:p1",
      cwd: "/a",
      origin: "self",
      drivable: true,
      readable: true,
      gated: true,
    });

    const { container } = renderScreen("/a");
    closeButtons(container)[0]?.click();

    expect(closed).toEqual([]);
  });

  test("a session the user opened in their own terminal offers no close control", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w9:p1",
      cwd: "/a",
      origin: "foreign",
      drivable: true,
      readable: true,
      gated: true,
    });

    const { container } = renderScreen("/a");

    expect(closeButtons(container).length).toBe(0);
    // The row itself stays open-able — this is a missing control, not a locked
    // card.
    expect(container.querySelectorAll(".lin-session-row").length).toBe(1);
  });
});

describe("ProjectDetailScreen session row title", () => {
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

  function titles(container: HTMLElement): (string | null)[] {
    return Array.from(container.querySelectorAll(".lin-session-title")).map((n) => n.textContent);
  }

  test("the pane's own title is what the row is called", () => {
    useAppStore.getState().upsertListedSession({
      sessionId: "w1F:p1",
      cwd: "/a",
      title: "Teammate idle notification received",
      origin: "foreign",
      drivable: true,
      readable: true,
      gated: true,
    });

    expect(titles(renderScreen("/a").container)).toEqual(["Teammate idle notification received"]);
  });

  test("a pane herdr gave no title for is not called 'new session'", () => {
    // The defect this replaces: the title came from `messages.length`, so a
    // pane the phone had never spoken to read "new session" — including one
    // that had been running for hours. Falling back to another invented name
    // would be the same bug wearing a different word, so the assertion is that
    // the row shows the pane id and claims nothing about newness.
    useAppStore.getState().upsertListedSession({
      sessionId: "w1F:p1",
      cwd: "/a",
      origin: "foreign",
      drivable: true,
      readable: true,
      gated: true,
    });

    const shown = titles(renderScreen("/a").container);
    expect(shown).toEqual(["w1F:p1"]);
    expect(shown[0]).not.toContain("new session");
  });

  test("two untitled panes stay distinguishable", () => {
    // With the title derived from a message count both of these read exactly
    // the same, which is how a session already running gets mistaken for a
    // blank one.
    for (const id of ["w1F:p1", "w4R:p1"]) {
      useAppStore.getState().upsertListedSession({
        sessionId: id,
        cwd: "/a",
        origin: "foreign",
        drivable: true,
        readable: true,
        gated: true,
      });
    }

    const shown = titles(renderScreen("/a").container);
    expect(shown.length).toBe(2);
    expect(new Set(shown).size).toBe(2);
  });
});
