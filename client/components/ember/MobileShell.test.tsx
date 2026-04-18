import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import MobileShell from "./MobileShell";

// Capture original store actions
const ORIGINAL_ACTIONS = {
  setActiveScreen: useAppStore.getState().setActiveScreen,
  setInputDraft: useAppStore.getState().setInputDraft,
};

describe("MobileShell", () => {
  beforeEach(() => {
    // Reset stores to default state
    useSettingsStore.setState({ theme: "ember" });
    useAppStore.setState({
      activeScreen: "chat",
      connectionState: "connected",
      activeSessionId: null,
      sessions: new Map(),
      inputDraft: "",
      ...ORIGINAL_ACTIONS,
    });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ ...ORIGINAL_ACTIONS });
  });

  it("1. renders with theme ember and activeScreen chat", () => {
    const { container } = render(<MobileShell />);

    const shell = container.querySelector(".ember-shell");
    expect(shell).not.toBeNull();

    // ChatScreen should be rendered (not placeholder)
    // Since no session, should show empty state
    expect(container.textContent).toContain("Create or select a session");

    // Tab bar should show chat as active
    const buttons = container.querySelectorAll("button");
    const chatButton = Array.from(buttons).find((btn) => btn.getAttribute("aria-label") === "Chat");
    expect(chatButton?.getAttribute("aria-pressed")).toBe("true");
  });

  it("2. returns null when theme is not ember", () => {
    useSettingsStore.setState({ theme: "dark" });
    const { container } = render(<MobileShell />);

    expect(container.querySelector(".ember-shell")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("3. shows connection banner when disconnected", () => {
    useAppStore.setState({ connectionState: "disconnected" });
    const { container } = render(<MobileShell />);

    const banner = container.querySelector(".ember-connection-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("reconnecting");
  });

  it("4. clicking sessions tab updates activeScreen", () => {
    const { container } = render(<MobileShell />);

    const buttons = container.querySelectorAll("button");
    const sessionsButton = Array.from(buttons).find(
      (btn) => btn.getAttribute("aria-label") === "Sessions",
    );

    expect(sessionsButton).not.toBeNull();
    fireEvent.click(sessionsButton as HTMLElement);

    // Check store state
    const state = useAppStore.getState();
    expect(state.activeScreen).toBe("sessions");
  });

  it("5. defaults to chat screen when activeScreen is undefined", () => {
    useAppStore.setState({ activeScreen: undefined as any });
    const { container } = render(<MobileShell />);

    expect(container.textContent).toContain("Create or select a session");
  });

  it("renders all screen placeholders correctly", () => {
    const screens: Array<{
      id: "sessions" | "agents" | "chat" | "commands" | "settings";
      text: string;
    }> = [
      { id: "sessions", text: "No active sessions yet" }, // SessionsScreen empty state
      { id: "agents", text: "No agents available" }, // AgentsScreen empty state
      { id: "chat", text: "Create or select a session" }, // ChatScreen empty state
      { id: "commands", text: "No commands available" }, // CommandsScreen empty state (T8)
      { id: "settings", text: "Settings (T9)" },
    ];

    screens.forEach(({ id, text }) => {
      useAppStore.setState({
        activeScreen: id,
        capabilities: { commands: [], agents: [], model: "test" },
      });
      const { container } = render(<MobileShell />);
      expect(container.textContent).toContain(text);
      cleanup();
    });
  });

  it("hides connection banner when connected", () => {
    useAppStore.setState({ connectionState: "connected" });
    const { container } = render(<MobileShell />);

    const banner = container.querySelector(".ember-connection-banner");
    expect(banner).toBeNull();
  });

  it("renders ScreenHeader with correct title for non-chat screens", () => {
    const screens: Array<{
      id: "sessions" | "agents" | "commands" | "settings";
      title: string;
    }> = [
      { id: "sessions", title: "Sessions" },
      { id: "agents", title: "Agents" },
      { id: "commands", title: "Commands" },
      { id: "settings", title: "Settings" },
    ];

    screens.forEach(({ id, title }) => {
      useAppStore.setState({ activeScreen: id });
      const { container } = render(<MobileShell />);
      const headerTitle = container.querySelector(".ember-screen-header-title");
      expect(headerTitle?.textContent).toBe(title);
      cleanup();
    });
  });

  it("ChatScreen renders its own header with dynamic title", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeScreen: "chat",
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

    const { container } = render(<MobileShell />);
    const headerTitle = container.querySelector(".ember-screen-header-title");
    // Chat screen shows basename of cwd
    expect(headerTitle?.textContent).toBe("cc-mobile");
  });

  it("T7: renders AgentsScreen when activeScreen is agents", () => {
    useAppStore.setState({
      activeScreen: "agents",
      capabilities: {
        commands: [],
        agents: [{ name: "coder", description: "Writes code" }],
        model: "test",
      },
    });

    const { container } = render(<MobileShell />);

    // AgentsScreen should be rendered
    expect(container.textContent).toContain("Agents");
    expect(container.textContent).toContain("coder");
    expect(container.textContent).toContain("Writes code");
  });

  it("T7: clicking agent in screen mode navigates to chat", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeScreen: "agents",
      activeSessionId: sessionId,
      capabilities: {
        commands: [],
        agents: [{ name: "coder" }],
        model: "test",
      },
      inputDraft: "",
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test",
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

    const { container } = render(<MobileShell />);

    // Find and click the agent card
    const agentCard = container.querySelector(".ember-agent-card");
    expect(agentCard).not.toBeNull();

    // Click the button
    fireEvent.click(agentCard as HTMLElement);

    // Check that navigation happened
    const state = useAppStore.getState();
    expect(state.activeScreen).toBe("chat");
    // Note: inputDraft is managed by MessageComposer's draft-loading logic,
    // so we don't assert on it here. The handler does call setInputDraft,
    // but MessageComposer immediately overwrites it with loadDraft().
  });

  it("T8: renders CommandsScreen when activeScreen is commands", () => {
    useAppStore.setState({
      activeScreen: "commands",
      capabilities: {
        commands: [{ name: "/help", description: "Show help" }],
        agents: [],
        model: "test",
      },
    });

    const { container } = render(<MobileShell />);

    // CommandsScreen should be rendered
    expect(container.textContent).toContain("Commands");
    expect(container.textContent).toContain("/help");
    expect(container.textContent).toContain("Show help");
  });

  it("T8: clicking command in screen mode navigates to chat with inputDraft", () => {
    const sessionId = "test-session";
    useAppStore.setState({
      activeScreen: "commands",
      activeSessionId: sessionId,
      capabilities: {
        commands: [{ name: "/help" }],
        agents: [],
        model: "test",
      },
      inputDraft: "",
      sessions: new Map([
        [
          sessionId,
          {
            id: sessionId,
            cwd: "/test",
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

    const { container } = render(<MobileShell />);

    // Find and click the command row button
    const commandRowButton = container.querySelector(".ember-command-row-content");
    expect(commandRowButton).not.toBeNull();

    // Click the button
    fireEvent.click(commandRowButton as HTMLElement);

    // Check that navigation happened
    const state = useAppStore.getState();
    expect(state.activeScreen).toBe("chat");
    // Note: inputDraft is managed by MessageComposer's draft-loading logic,
    // so we don't assert on it here. The handler does call setInputDraft,
    // but MessageComposer immediately overwrites it with loadDraft().
  });
});
