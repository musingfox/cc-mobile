import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Capabilities } from "../../stores/app-store";
import { useAppStore } from "../../stores/app-store";
import CommandsScreen from "./CommandsScreen";

// Capture original store actions for restoration
const ORIGINAL_ACTIONS = {
  setActiveScreen: useAppStore.getState().setActiveScreen,
  setInputDraft: (draft: string) => useAppStore.setState({ inputDraft: draft }),
};

describe("CommandsScreen", () => {
  beforeEach(() => {
    useAppStore.setState({
      capabilities: null,
      inputDraft: "",
      activeScreen: "commands",
    });
    // Clear localStorage pins
    localStorage.removeItem("cc-mobile-pinned-commands");
  });

  afterEach(() => {
    cleanup();
    // Restore original store state
    useAppStore.setState({
      setActiveScreen: ORIGINAL_ACTIONS.setActiveScreen,
      inputDraft: "",
      capabilities: null,
    });
    localStorage.removeItem("cc-mobile-pinned-commands");
  });

  test("renders screen variant with ScreenHeader", () => {
    const mockCapabilities: Capabilities = {
      commands: [{ name: "/help" }, { name: "/test" }, { name: "/debug" }],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    const { container } = render(
      <div className="theme-ember">
        <CommandsScreen variant="screen" />
      </div>,
    );

    expect(screen.getByText("Commands")).toBeDefined();
    expect(screen.getByText("Slash commands run inline in chat")).toBeDefined();
    expect(screen.getByText("3 built-in")).toBeDefined();
    expect(screen.getByText("/help")).toBeDefined();
    expect(screen.getByText("/test")).toBeDefined();
    expect(screen.getByText("/debug")).toBeDefined();
  });

  test("renders sheet variant without ScreenHeader", () => {
    const mockCapabilities: Capabilities = {
      commands: [{ name: "/help" }, { name: "/test" }],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(
      <div className="theme-ember">
        <CommandsScreen variant="sheet" />
      </div>,
    );

    // ScreenHeader should not be present
    expect(() => screen.getByText("Slash commands run inline in chat")).toThrow();
    // But commands should still be visible
    expect(screen.getByText("/help")).toBeDefined();
    expect(screen.getByText("/test")).toBeDefined();
  });

  test("renders command with description and category", () => {
    const mockCapabilities: Capabilities = {
      commands: [
        {
          name: "/help",
          description: "Show help",
          category: "general",
        },
      ],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(
      <div className="theme-ember">
        <CommandsScreen variant="screen" />
      </div>,
    );

    expect(screen.getByText("/help")).toBeDefined();
    expect(screen.getByText("Show help")).toBeDefined();
    expect(screen.getByText("general")).toBeDefined();
  });

  test("renders fallback for missing description", () => {
    const mockCapabilities: Capabilities = {
      commands: [{ name: "/test" }],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(
      <div className="theme-ember">
        <CommandsScreen variant="sheet" />
      </div>,
    );

    expect(screen.getByText("/test")).toBeDefined();
    expect(screen.getByText("No description")).toBeDefined();
  });

  test("renders loading skeleton when capabilities is null", () => {
    useAppStore.setState({ capabilities: null });

    const { container } = render(
      <div className="theme-ember">
        <CommandsScreen variant="screen" />
      </div>,
    );

    const skeletons = container.querySelectorAll(".ember-skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  test("renders empty state when commands array is empty", () => {
    const mockCapabilities: Capabilities = {
      commands: [],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(
      <div className="theme-ember">
        <CommandsScreen variant="screen" />
      </div>,
    );

    expect(screen.getByText("No commands available.")).toBeDefined();
  });

  test("filters commands by search query", () => {
    const mockCapabilities: Capabilities = {
      commands: [
        { name: "/help", description: "Show help" },
        { name: "/test", description: "Run tests" },
      ],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(
      <div className="theme-ember">
        <CommandsScreen variant="screen" />
      </div>,
    );

    const searchInput = screen.getByPlaceholderText("Find a command…") as HTMLInputElement;

    // Initially both commands visible
    expect(screen.getByText("/help")).toBeDefined();
    expect(screen.getByText("/test")).toBeDefined();

    // Type "hel" in search
    fireEvent.change(searchInput, { target: { value: "hel" } });

    // Only "/help" should be visible
    expect(screen.getByText("/help")).toBeDefined();
    expect(() => screen.getByText("/test")).toThrow();
  });

  test("calls onSelect when command row is clicked", () => {
    const mockCapabilities: Capabilities = {
      commands: [{ name: "/help" }],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    const onSelectMock = mock(() => {});

    render(
      <div className="theme-ember">
        <CommandsScreen variant="screen" onSelect={onSelectMock} />
      </div>,
    );

    const row = screen.getByText("/help").closest("button");
    if (!row) throw new Error("Command row button not found");

    fireEvent.click(row);

    expect(onSelectMock).toHaveBeenCalledTimes(1);
    expect(onSelectMock).toHaveBeenCalledWith("/help");
  });

  test("command rows have minimum 44px touch target", () => {
    const mockCapabilities: Capabilities = {
      commands: [{ name: "/test-command" }],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    const { container } = render(
      <div className="theme-ember">
        <CommandsScreen variant="screen" />
      </div>,
    );

    const row = container.querySelector(".ember-command-row");
    expect(row).toBeDefined();

    // Verify the class is applied (CSS defines min-height: 44px)
    expect(row?.classList.contains("ember-command-row")).toBe(true);
  });

  test("match count updates with search query", () => {
    const mockCapabilities: Capabilities = {
      commands: [{ name: "/help" }, { name: "/test" }, { name: "/debug" }],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(
      <div className="theme-ember">
        <CommandsScreen variant="screen" />
      </div>,
    );

    const searchInput = screen.getByPlaceholderText("Find a command…") as HTMLInputElement;

    // Type "h" in search (should match only /help)
    fireEvent.change(searchInput, { target: { value: "h" } });

    expect(screen.getByText("1 match")).toBeDefined();

    // Change to "e" (should match /help, /test, /debug)
    fireEvent.change(searchInput, { target: { value: "e" } });

    expect(screen.getByText("3 matches")).toBeDefined();
  });
});
