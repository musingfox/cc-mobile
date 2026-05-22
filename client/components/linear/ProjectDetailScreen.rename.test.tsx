import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import ProjectDetailScreen from "./ProjectDetailScreen";

describe("ProjectDetailScreen rename affordance", () => {
  const originalResume = wsService.resumeSession;
  const originalSetTitle = wsService.setSessionTitle;
  const originalListSessions = wsService.listSessions;

  beforeEach(() => {
    wsService.resumeSession = mock(() => {}) as typeof wsService.resumeSession;
    wsService.setSessionTitle = mock(() => {}) as typeof wsService.setSessionTitle;
    wsService.listSessions = mock(() => {}) as typeof wsService.listSessions;
    useAppStore.setState({
      sessions: new Map(),
      sessionList: [
        {
          sdkSessionId: "sdk-server-1",
          displayTitle: "Server session",
          cwd: "/work",
          lastModified: Date.now(),
          customTitle: undefined,
        },
      ],
      activeSessionId: null,
      connectionState: "connected",
    });
  });

  afterEach(() => {
    wsService.resumeSession = originalResume;
    wsService.setSessionTitle = originalSetTitle;
    wsService.listSessions = originalListSessions;
    cleanup();
  });

  test("server-list rows render a rename button", () => {
    const { getAllByLabelText } = render(
      <ProjectDetailScreen cwd="/work" onNavigate={() => {}} onBack={() => {}} />,
    );
    expect(getAllByLabelText("Rename session").length).toBe(1);
  });

  test("memory-only rows do not render a rename button", () => {
    useAppStore.setState({
      sessions: new Map([
        [
          "ws-1",
          {
            id: "ws-1",
            cwd: "/work",
            sdkSessionId: null,
            messages: [],
            pendingPermission: null,
            isStreaming: false,
            currentStreamMessageId: null,
            activeTools: new Map(),
            activeAgents: new Map(),
            activeHook: null,
            usage: null,
            promptSuggestion: null,
            resolvedActions: [],
            agentState: null,
            receivedAuthoritativeState: false,
          },
        ],
      ]),
      sessionList: [],
    });

    const { queryAllByLabelText } = render(
      <ProjectDetailScreen cwd="/work" onNavigate={() => {}} onBack={() => {}} />,
    );
    expect(queryAllByLabelText("Rename session").length).toBe(0);
  });

  test("clicking rename does not navigate to chat and opens the sheet", () => {
    const onNavigate = mock((_: string) => {});
    const { getByLabelText, queryByLabelText } = render(
      <ProjectDetailScreen cwd="/work" onNavigate={onNavigate} onBack={() => {}} />,
    );

    expect(queryByLabelText("Session title")).toBeNull();
    fireEvent.click(getByLabelText("Rename session"));

    expect(onNavigate).not.toHaveBeenCalled();
    expect(wsService.resumeSession).not.toHaveBeenCalled();
    // Sheet opens — the title input becomes available.
    expect(queryByLabelText("Session title")).not.toBeNull();
  });
});
