import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { removeProject, saveProject } from "../../services/projects";
import { useAppStore } from "../../stores/app-store";
import ProjectsScreen from "./ProjectsScreen";

const PROJECTS_KEY = "cc-mobile-projects";

function seedProjects(entries: Array<{ cwd: string; label?: string }>) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(entries));
}

function renderScreen() {
  return render(
    <ProjectsScreen onNavigate={() => {}} onOpenProject={() => {}} onAddProject={() => {}} />,
  );
}

describe("ProjectsScreen rows come only from saved projects", () => {
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

  test("a session whose cwd is not a saved project produces no row", () => {
    seedProjects([{ cwd: "/a", label: "a" }]);
    const store = useAppStore.getState();
    store.addSession("s1", "/a");
    store.addSession("s2", "/b");

    const { container, getByText } = renderScreen();

    expect(container.querySelectorAll(".lin-project-row").length).toBe(1);
    expect(getByText("a")).not.toBeNull();
    expect(getByText("1 session")).not.toBeNull();
  });

  test("saved projects render in saved order and show no count without sessions", () => {
    seedProjects([{ cwd: "/a" }, { cwd: "/b" }]);

    const { container } = renderScreen();

    const titles = [...container.querySelectorAll(".lin-project-title")].map((n) => n.textContent);
    expect(titles).toEqual(["a", "b"]);
    expect(container.textContent).not.toContain("session");
  });

  test("no saved projects renders the empty state even when sessions exist", () => {
    seedProjects([]);
    useAppStore.getState().addSession("s1", "/b");

    const { container, getByText } = renderScreen();

    expect(container.querySelectorAll(".lin-project-row").length).toBe(0);
    expect(getByText("+ Add your first project")).not.toBeNull();
  });

  test("a removed project stays removed", () => {
    seedProjects([{ cwd: "/a" }]);
    const first = renderScreen();
    expect(first.container.querySelectorAll(".lin-project-row").length).toBe(1);

    removeProject("/a");
    cleanup();
    const { container, getByText } = renderScreen();

    expect(container.querySelectorAll(".lin-project-row").length).toBe(0);
    expect(getByText("+ Add your first project")).not.toBeNull();
  });

  test("a project saved during a session-map mutation appears without another trigger", () => {
    seedProjects([]);
    const store = useAppStore.getState();
    store.addSession("u1", "/new", { ready: false });

    const { container } = renderScreen();
    expect(container.querySelectorAll(".lin-project-row").length).toBe(0);

    // What the terminal_created handler does: persist the project, then flip
    // the readiness marker. The map size never changes, only its identity.
    act(() => {
      saveProject("/new");
      useAppStore.getState().setTerminalReady("u1", true);
    });

    expect(container.querySelectorAll(".lin-project-row").length).toBe(1);
    expect(container.textContent).toContain("new");
  });
});
