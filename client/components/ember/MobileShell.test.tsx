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
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("1. renders with theme ember and activeScreen chat", () => {
    const { container } = render(<MobileShell />);

    const shell = container.querySelector(".ember-shell");
    expect(shell).not.toBeNull();

    // Chat placeholder should be visible
    expect(container.textContent).toContain("Chat (T5)");

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

    expect(container.textContent).toContain("Chat (T5)");
  });

  it("renders all screen placeholders correctly", () => {
    const screens: Array<{
      id: "sessions" | "agents" | "chat" | "commands" | "settings";
      text: string;
    }> = [
      { id: "sessions", text: "Sessions (T6)" },
      { id: "agents", text: "Agents (T7)" },
      { id: "chat", text: "Chat (T5)" },
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

  it("renders ScreenHeader with correct title for each screen", () => {
    const screens: Array<{
      id: "sessions" | "agents" | "chat" | "commands" | "settings";
      title: string;
    }> = [
      { id: "sessions", title: "Sessions" },
      { id: "agents", title: "Agents" },
      { id: "chat", title: "Chat" },
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
});
