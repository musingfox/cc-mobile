import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import type { SessionState } from "../../stores/app-store";
import { useAppStore } from "../../stores/app-store";
import SessionsScreen from "./SessionsScreen";

// Mock wsService
mock.module("../../services/ws-service", () => ({
  wsService: {
    listSessions: mock(() => {}),
    resumeSession: mock(() => {}),
    createSession: mock(() => {}),
  },
}));

describe("SessionsScreen", () => {
  beforeEach(() => {
    // Reset store state
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      sessionList: [],
      globalError: null,
      connectionState: "connected",
    });

    // Clear all mocks
    mock.restore();
  });

  it("renders with 2 active sessions, one streaming", () => {
    const session1: SessionState = {
      id: "session-1",
      cwd: "/home/user/project1",
      sdkSessionId: "sdk-1",
      messages: [{ id: "m1", role: "user", content: "Hello", timestamp: Date.now() }],
      pendingPermission: null,
      isStreaming: true,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: "running",
      receivedAuthoritativeState: false,
    };

    const session2: SessionState = {
      id: "session-2",
      cwd: "/home/user/project2",
      sdkSessionId: "sdk-2",
      messages: [{ id: "m2", role: "user", content: "Test", timestamp: Date.now() }],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: "idle",
      receivedAuthoritativeState: false,
    };

    useAppStore.setState({
      sessions: new Map([
        ["session-1", session1],
        ["session-2", session2],
      ]),
      activeSessionId: "session-1",
      connectionState: "connected",
    });

    render(
      <div className="theme-ember">
        <SessionsScreen />
      </div>,
    );

    // Check that both cards are rendered under ACTIVE
    expect(screen.getByText("ACTIVE")).toBeDefined();
    const sessionCards = screen.getAllByText("project1");
    // Should have at least 1 card with project1 (plus subtitle)
    expect(sessionCards.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("project2")).toBeDefined();

    // Check badges
    const activeBadge = screen.getByText(/● ACTIVE/);
    expect(activeBadge).toBeDefined();
    expect(activeBadge.getAttribute("data-color")).toBe("sage");

    const idleBadge = screen.getByText(/● IDLE/);
    expect(idleBadge).toBeDefined();
    expect(idleBadge.getAttribute("data-color")).toBe("dim");
  });

  it("shows empty states when no sessions", async () => {
    useAppStore.setState({
      sessions: new Map(),
      sessionList: [],
      connectionState: "connected",
    });

    render(
      <div className="theme-ember">
        <SessionsScreen />
      </div>,
    );

    expect(screen.getByText(/No active sessions yet/)).toBeDefined();

    // Wait for loading to finish (2s timeout in component)
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(screen.getByText(/No recent sessions/)).toBeDefined();
  });

  it("renders 3 recent sessions with titles and branches", () => {
    useAppStore.setState({
      sessions: new Map(),
      sessionList: [
        {
          sdkSessionId: "sdk-r1",
          displayTitle: "Feature work",
          cwd: "/home/user/project1",
          gitBranch: "feature/test",
          lastModified: Date.now() - 3600000, // 1h ago
        },
        {
          sdkSessionId: "sdk-r2",
          displayTitle: "Bug fix",
          cwd: "/home/user/project2",
          gitBranch: "fix/bug-123",
          lastModified: Date.now() - 7200000, // 2h ago
        },
        {
          sdkSessionId: "sdk-r3",
          displayTitle: "Refactor",
          cwd: "/home/user/project3",
          lastModified: Date.now() - 86400000, // 1d ago
        },
      ],
      connectionState: "connected",
    });

    render(
      <div className="theme-ember">
        <SessionsScreen />
      </div>,
    );

    expect(screen.getByText("RECENT")).toBeDefined();
    expect(screen.getByText("Feature work")).toBeDefined();
    expect(screen.getByText("Bug fix")).toBeDefined();
    expect(screen.getByText("Refactor")).toBeDefined();

    // Check branch pills
    expect(screen.getByText(/⎇ feature\/test/)).toBeDefined();
    expect(screen.getByText(/⎇ fix\/bug-123/)).toBeDefined();
  });

  it("calls setActiveSession and setActiveScreen when clicking active session card", () => {
    const session: SessionState = {
      id: "session-1",
      cwd: "/home/user/project",
      sdkSessionId: "sdk-1",
      messages: [],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
    };

    useAppStore.setState({
      sessions: new Map([["session-1", session]]),
      activeSessionId: null,
      connectionState: "connected",
    });

    const setActiveSessionMock = mock(() => {});
    const setActiveScreenMock = mock(() => {});
    useAppStore.setState({
      setActiveSession: setActiveSessionMock,
      setActiveScreen: setActiveScreenMock,
    });

    render(
      <div className="theme-ember">
        <SessionsScreen />
      </div>,
    );

    const card = screen.getByText("project").closest("button");
    expect(card).toBeDefined();
    fireEvent.click(card!);

    expect(setActiveSessionMock).toHaveBeenCalledWith("session-1");
    expect(setActiveScreenMock).toHaveBeenCalledWith("chat");
  });

  it("calls wsService.resumeSession and setActiveScreen when clicking recent session card", () => {
    useAppStore.setState({
      sessions: new Map(),
      sessionList: [
        {
          sdkSessionId: "sdk-recent",
          displayTitle: "Recent session",
          cwd: "/home/user/project",
          lastModified: Date.now() - 3600000,
        },
      ],
      connectionState: "connected",
    });

    const resumeSessionMock = mock(() => {});
    const setActiveScreenMock = mock(() => {});
    (wsService.resumeSession as any) = resumeSessionMock;
    useAppStore.setState({
      setActiveScreen: setActiveScreenMock,
    });

    render(
      <div className="theme-ember">
        <SessionsScreen />
      </div>,
    );

    const card = screen.getByText("Recent session").closest("button");
    expect(card).toBeDefined();
    fireEvent.click(card!);

    expect(resumeSessionMock).toHaveBeenCalledWith("sdk-recent", "/home/user/project");
    expect(setActiveScreenMock).toHaveBeenCalledWith("chat");
  });

  it("opens RecentDrawer when clicking + New button", () => {
    useAppStore.setState({
      sessions: new Map(),
      connectionState: "connected",
    });

    render(
      <div className="theme-ember">
        <SessionsScreen />
      </div>,
    );

    const newButton = screen.getByLabelText("New session");
    expect(newButton).toBeDefined();
    fireEvent.click(newButton);

    // RecentDrawer should be rendered (check by title)
    expect(screen.getByText("Recent Projects")).toBeDefined();
  });

  it("shows global error banner with close button", () => {
    useAppStore.setState({
      sessions: new Map(),
      globalError: "Whoops",
      connectionState: "connected",
    });

    const setGlobalErrorMock = mock(() => {});
    useAppStore.setState({
      setGlobalError: setGlobalErrorMock,
    });

    render(
      <div className="theme-ember">
        <SessionsScreen />
      </div>,
    );

    expect(screen.getByText("Whoops")).toBeDefined();

    const closeButton = screen.getByLabelText("Dismiss error");
    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton);

    expect(setGlobalErrorMock).toHaveBeenCalledWith(null);
  });

  it("shows retry button when disconnected and no session history", () => {
    useAppStore.setState({
      sessions: new Map(),
      sessionList: [],
      connectionState: "disconnected",
    });

    const listSessionsMock = mock(() => {});
    (wsService.listSessions as any) = listSessionsMock;

    render(
      <div className="theme-ember">
        <SessionsScreen />
      </div>,
    );

    expect(screen.getByText(/Could not load session history/)).toBeDefined();

    const retryButton = screen.getByText("Retry");
    expect(retryButton).toBeDefined();
    fireEvent.click(retryButton);

    expect(listSessionsMock).toHaveBeenCalled();
  });

  it("verifies touch target min-height for session cards", () => {
    const session: SessionState = {
      id: "session-1",
      cwd: "/home/user/project",
      sdkSessionId: "sdk-1",
      messages: [],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
    };

    useAppStore.setState({
      sessions: new Map([["session-1", session]]),
      connectionState: "connected",
    });

    render(
      <div className="theme-ember">
        <SessionsScreen />
      </div>,
    );

    const card = screen.getByText("project").closest("button");
    expect(card).toBeDefined();

    // Check via CSS class that should enforce min-height: 44px
    expect(card?.classList.contains("ember-session-card")).toBe(true);
  });
});
