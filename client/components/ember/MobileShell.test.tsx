import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import MobileShell from "./MobileShell";

describe("MobileShell", () => {
  beforeEach(() => {
    // Reset stores to default state
    useSettingsStore.setState({ theme: "ember" });
    useAppStore.setState({
      activeScreen: "chat",
      connectionState: "connected",
      activeSessionId: null,
      sessions: new Map(),
    });
  });

  afterEach(() => {
    cleanup();
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
      { id: "sessions", text: "Sessions (T6)" },
      { id: "agents", text: "Agents (T7)" },
      { id: "chat", text: "Create or select a session" }, // ChatScreen empty state
      { id: "commands", text: "Commands (T8)" },
      { id: "settings", text: "Settings (T9)" },
    ];

    screens.forEach(({ id, text }) => {
      useAppStore.setState({ activeScreen: id });
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
});
