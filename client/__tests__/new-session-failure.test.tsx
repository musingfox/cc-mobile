import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import AppShell from "../components/linear/AppShell";
import { saveProject } from "../services/projects";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * A "New session" the server refuses must leave the user where they started.
 *
 * Audit 2026-10-03 #1: the chat opened optimistically, the refusal removed the
 * optimistic session, and the store handed the active slot to the first session
 * in its Map — a foreign pane in another project, with a live composer.
 */

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
    handleMessage: (msg: Record<string, unknown>) => void;
    pendingTerminalCreates: Set<string>;
  };
}

describe("a refused New session", () => {
  const originalError = toastService.error;
  let prevWs: WebSocket | null;

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "");
    prevWs = getInternal().ws;
    getInternal().ws = { send: () => {} } as unknown as WebSocket;
    getInternal().pendingTerminalCreates.clear();
    toastService.error = mock((_msg: string): string | number => 0) as typeof toastService.error;
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      connectionState: "connected",
      availableAgents: [],
      agentProfiles: [],
    });
    useAppStore.getState().upsertListedSession({
      sessionId: "wHQ:p1",
      cwd: "/Users/someone/workspace/cyris",
      origin: "foreign",
      drivable: true,
      readable: true,
      gated: true,
    });
    saveProject("/Users/someone/workspace/scratch");
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    window.history.replaceState(null, "");
    getInternal().ws = prevWs;
    getInternal().pendingTerminalCreates.clear();
    toastService.error = originalError;
  });

  test("returns to the project screen and points nothing at the unrelated session", async () => {
    const { container, getByText } = render(<AppShell />);

    fireEvent.click(getByText("scratch"));
    fireEvent.click(getByText("New session in this project"));
    expect(container.querySelector(".lin-chat")).not.toBeNull();

    act(() => {
      getInternal().handleMessage({
        type: "error",
        code: "terminal_error",
        message: "agent_pane_busy: agent target pane wJ4:p1 is not an available shell",
      });
    });

    expect(useAppStore.getState().activeSessionId).toBeNull();
    // Back over the chat's history entry, the step an in-app Back takes.
    await waitFor(() =>
      expect(container.querySelector(".lin-projects-detail-name")?.textContent).toBe("scratch"),
    );
    expect(container.querySelector(".lin-chat")).toBeNull();
    expect(container.querySelector(".lin-input-bar")).toBeNull();
    expect(toastService.error).toHaveBeenCalledTimes(1);
  });

  test("a session that ends while it is open does not hand the chat to another one", async () => {
    const { container, getByText } = render(<AppShell />);
    fireEvent.click(getByText("scratch"));
    fireEvent.click(getByText("New session in this project"));
    const created = useAppStore.getState().activeSessionId as string;
    act(() => {
      getInternal().handleMessage({
        type: "terminal_created",
        claudeUuid: created,
        sessionId: "wJ5:p1",
      });
    });
    expect(useAppStore.getState().activeSessionId).toBe("wJ5:p1");

    act(() => {
      getInternal().handleMessage({
        type: "terminal_sessions",
        sessions: [
          {
            sessionId: "wHQ:p1",
            cwd: "/Users/someone/workspace/cyris",
            origin: "foreign",
            drivable: true,
            readable: true,
            gated: true,
          },
        ],
      });
    });

    expect(useAppStore.getState().activeSessionId).toBeNull();
    await waitFor(() =>
      expect(container.querySelector(".lin-projects-detail-name")?.textContent).toBe("scratch"),
    );
    expect(container.querySelector(".lin-input-bar")).toBeNull();
  });

  test("leaving a dead chat steps back once, not past the project", async () => {
    const { container, getByText } = render(<AppShell />);
    fireEvent.click(getByText("scratch"));
    fireEvent.click(getByText("New session in this project"));

    act(() => {
      getInternal().handleMessage({
        type: "error",
        code: "terminal_error",
        message: "agent_pane_busy: agent target pane wJ4:p1 is not an available shell",
      });
    });

    await waitFor(() =>
      expect(container.querySelector(".lin-projects-detail-name")?.textContent).toBe("scratch"),
    );
    const screens = (window.history.state as { screens: { screen: string }[] }).screens;
    expect(screens.map((entry) => entry.screen)).toEqual(["projects", "projectDetail"]);
  });
});
