import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import ChatScreen from "./ChatScreen";

describe("ChatScreen", () => {
  beforeEach(() => {
    useSettingsStore.setState({ theme: "ember" });
    useAppStore.setState({
      activeSessionId: null,
      sessions: new Map(),
      capabilities: {
        commands: [{ name: "test" }],
        agents: [{ name: "agent" }],
        model: "test-model",
      },
      connectionState: "connected",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("1. renders with active session with 1 user + 1 assistant message", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeSessionId: sessionId,
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test/cc-mobile",
            sdkSessionId: "sdk-1",
            messages: [
              {
                id: "msg-1",
                role: "user" as const,
                content: "Hello",
                timestamp: Date.now(),
              },
              {
                id: "msg-2",
                role: "assistant" as const,
                content: "Hi there",
                timestamp: Date.now(),
              },
            ],
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
    });

    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    expect(container.textContent).toContain("Hello");
    expect(container.textContent).toContain("Hi there");

    const userMessages = container.querySelectorAll(".ember-message--user");
    expect(userMessages.length).toBe(1);

    const assistantMessages = container.querySelectorAll(".ember-message--assistant");
    expect(assistantMessages.length).toBe(1);
  });

  it("2. shows blinking cursor when streaming last assistant message", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeSessionId: sessionId,
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test/cc-mobile",
            sdkSessionId: "sdk-1",
            messages: [
              {
                id: "msg-x",
                role: "assistant" as const,
                content: "Streaming text",
                timestamp: Date.now(),
              },
            ],
            pendingPermission: null,
            isStreaming: true,
            currentStreamMessageId: "msg-x",
            activeTools: new Map(),
            activeAgents: new Map(),
            activeHook: null,
            usage: null,
            promptSuggestion: null,
            resolvedActions: [],
            agentState: "running",
            receivedAuthoritativeState: true,
          },
        ],
      ]),
    });

    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    const cursor = container.querySelector(".ember-cursor");
    expect(cursor).not.toBeNull();
  });

  it("3. shows empty state when no active session", () => {
    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    expect(container.textContent).toContain("Create or select a session");
    expect(container.textContent).toContain("Go to Sessions");

    const textarea = container.querySelector(".ember-composer-textarea") as HTMLTextAreaElement;
    expect(textarea?.disabled).toBe(true);
  });

  it("4. renders PermissionBar when pendingPermission !== null", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeSessionId: sessionId,
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test/cc-mobile",
            sdkSessionId: "sdk-1",
            messages: [],
            pendingPermission: {
              requestId: "req-1",
              tool: { name: "Bash", parameters: { command: "ls" } },
            },
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
    });

    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    const permissionBar = container.querySelector(".permission-bar");
    expect(permissionBar).not.toBeNull();
  });

  it("5. renders ActivityPanel when activeTools.size > 0", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeSessionId: sessionId,
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test/cc-mobile",
            sdkSessionId: "sdk-1",
            messages: [],
            pendingPermission: null,
            isStreaming: true,
            currentStreamMessageId: null,
            activeTools: new Map([
              [
                "tool-1",
                {
                  toolName: "Read",
                  startedAt: Date.now(),
                  input: { file_path: "test.ts" },
                },
              ],
            ]),
            activeAgents: new Map(),
            activeHook: null,
            usage: null,
            promptSuggestion: null,
            resolvedActions: [],
            agentState: "running",
            receivedAuthoritativeState: true,
          },
        ],
      ]),
    });

    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    const activityPanel = container.querySelector(".activity-panel");
    expect(activityPanel).not.toBeNull();
  });

  it("6. opens agents BottomSheet when lambda button clicked", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeSessionId: sessionId,
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test/cc-mobile",
            sdkSessionId: "sdk-1",
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
    });

    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    const agentButton = container.querySelector('button[aria-label="Open agents"]');
    expect(agentButton).not.toBeNull();
    fireEvent.click(agentButton as HTMLElement);

    const bottomSheet = container.querySelector(".ember-bottom-sheet");
    expect(bottomSheet).not.toBeNull();
    expect(container.textContent).toContain("Agents (T7)");
  });

  it("7. opens commands BottomSheet when slash button clicked", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeSessionId: sessionId,
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test/cc-mobile",
            sdkSessionId: "sdk-1",
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
    });

    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    const commandButton = container.querySelector('button[aria-label="Open commands"]');
    expect(commandButton).not.toBeNull();
    fireEvent.click(commandButton as HTMLElement);

    const bottomSheet = container.querySelector(".ember-bottom-sheet");
    expect(bottomSheet).not.toBeNull();
    expect(container.textContent).toContain("Commands (T8)");
  });

  it("8. renders ToolResultCard for tool message and toggles expand/collapse", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeSessionId: sessionId,
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test/cc-mobile",
            sdkSessionId: "sdk-1",
            messages: [
              {
                id: "tool-1",
                role: "tool" as const,
                content: "File contents here",
                timestamp: Date.now(),
                toolName: "Read",
                toolInput: { file_path: "test.ts" },
              },
            ],
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
    });

    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    const toolCard = container.querySelector(".ember-tool-card");
    expect(toolCard).not.toBeNull();

    // Initially collapsed
    let body = container.querySelector(".ember-tool-card-body");
    expect(body).toBeNull();

    // Click to expand
    const header = container.querySelector(".ember-tool-card-header");
    fireEvent.click(header as HTMLElement);

    body = container.querySelector(".ember-tool-card-body");
    expect(body).not.toBeNull();
    expect(container.textContent).toContain("File contents here");

    // Click again to collapse
    fireEvent.click(header as HTMLElement);
    body = container.querySelector(".ember-tool-card-body");
    expect(body).toBeNull();
  });

  it("9. renders prompt suggestion chip when promptSuggestion present", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeSessionId: sessionId,
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test/cc-mobile",
            sdkSessionId: "sdk-1",
            messages: [],
            pendingPermission: null,
            isStreaming: false,
            currentStreamMessageId: null,
            activeTools: new Map(),
            activeAgents: new Map(),
            activeHook: null,
            usage: null,
            promptSuggestion: "Try running tests",
            resolvedActions: [],
            agentState: null,
            receivedAuthoritativeState: false,
          },
        ],
      ]),
    });

    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    expect(container.textContent).toContain("Suggested:");
    expect(container.textContent).toContain("Try running tests");
  });

  it("10. renders AttachmentPreview for messages with contentBlocks", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeSessionId: sessionId,
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test/cc-mobile",
            sdkSessionId: "sdk-1",
            messages: [
              {
                id: "msg-1",
                role: "user" as const,
                content: "Check this image",
                timestamp: Date.now(),
                contentBlocks: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                    },
                  },
                ],
              },
            ],
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
    });

    const { container } = render(
      <div className="theme-ember">
        <ChatScreen />
      </div>,
    );

    const images = container.querySelectorAll(".ember-message-attachment-image");
    expect(images.length).toBe(1);
  });
});
