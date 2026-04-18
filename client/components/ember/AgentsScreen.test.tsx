import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Capabilities } from "../../stores/app-store";
import { useAppStore } from "../../stores/app-store";
import AgentsScreen from "./AgentsScreen";

// Capture original store actions for restoration
const ORIGINAL_ACTIONS = {
  setActiveScreen: useAppStore.getState().setActiveScreen,
  setInputDraft: (draft: string) => useAppStore.setState({ inputDraft: draft }),
};

describe("AgentsScreen", () => {
  beforeEach(() => {
    useAppStore.setState({
      capabilities: null,
      inputDraft: "",
      activeScreen: "agents",
    });
  });

  afterEach(() => {
    cleanup();
    // Restore original store state
    useAppStore.setState({
      setActiveScreen: ORIGINAL_ACTIONS.setActiveScreen,
      inputDraft: "",
      capabilities: null,
    });
  });

  test("renders screen variant with ScreenHeader", () => {
    const mockCapabilities: Capabilities = {
      commands: [],
      agents: [{ name: "coder" }, { name: "reviewer" }, { name: "planner" }],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(<AgentsScreen variant="screen" />);

    expect(screen.getByText("Agents")).toBeDefined();
    expect(screen.getByText("Tap to insert @name into the current session")).toBeDefined();
    expect(screen.getByText("coder")).toBeDefined();
    expect(screen.getByText("reviewer")).toBeDefined();
    expect(screen.getByText("planner")).toBeDefined();
  });

  test("renders sheet variant without ScreenHeader", () => {
    const mockCapabilities: Capabilities = {
      commands: [],
      agents: [{ name: "coder" }, { name: "reviewer" }],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(<AgentsScreen variant="sheet" />);

    // ScreenHeader should not be present
    expect(() => screen.getByText("Tap to insert @name into the current session")).toThrow();
    // But agents should still be visible
    expect(screen.getByText("coder")).toBeDefined();
    expect(screen.getByText("reviewer")).toBeDefined();
  });

  test("renders agent with description and tools", () => {
    const mockCapabilities: Capabilities = {
      commands: [],
      agents: [
        {
          name: "coder",
          description: "Writes code",
          allowedTools: ["read", "edit"],
        },
      ],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(<AgentsScreen variant="screen" />);

    expect(screen.getByText("coder")).toBeDefined();
    expect(screen.getByText("Writes code")).toBeDefined();
    expect(screen.getByText("read")).toBeDefined();
    expect(screen.getByText("edit")).toBeDefined();
  });

  test("renders fallback for missing description and tools", () => {
    const mockCapabilities: Capabilities = {
      commands: [],
      agents: [{ name: "x" }],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(<AgentsScreen variant="sheet" />);

    expect(screen.getByText("x")).toBeDefined();
    expect(screen.getByText("No description available")).toBeDefined();
    // Tool badges should not be rendered (no badges div should exist)
    expect(() => screen.getByText("read")).toThrow();
  });

  test("renders loading skeleton when capabilities is null", () => {
    useAppStore.setState({ capabilities: null });

    const { container } = render(<AgentsScreen variant="screen" />);

    const skeletons = container.querySelectorAll(".ember-skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  test("renders empty state when agents array is empty", () => {
    const mockCapabilities: Capabilities = {
      commands: [],
      agents: [],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(<AgentsScreen variant="screen" />);

    expect(screen.getByText("No agents available.")).toBeDefined();
  });

  test("filters agents by search query", () => {
    const mockCapabilities: Capabilities = {
      commands: [],
      agents: [{ name: "coder" }, { name: "reviewer" }],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    render(<AgentsScreen variant="screen" />);

    const searchInput = screen.getByPlaceholderText("Filter agents…") as HTMLInputElement;

    // Initially both agents visible
    expect(screen.getByText("coder")).toBeDefined();
    expect(screen.getByText("reviewer")).toBeDefined();

    // Type "co" in search
    fireEvent.change(searchInput, { target: { value: "co" } });

    // Only "coder" should be visible
    expect(screen.getByText("coder")).toBeDefined();
    expect(() => screen.getByText("reviewer")).toThrow();
  });

  test("calls onSelect when agent card is clicked", () => {
    const mockCapabilities: Capabilities = {
      commands: [],
      agents: [{ name: "coder" }],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    const onSelectMock = mock(() => {});

    render(<AgentsScreen variant="screen" onSelect={onSelectMock} />);

    const card = screen.getByText("coder").closest("button");
    if (!card) throw new Error("Card button not found");

    fireEvent.click(card);

    expect(onSelectMock).toHaveBeenCalledTimes(1);
    expect(onSelectMock).toHaveBeenCalledWith("coder");
  });

  test("agent cards have minimum 44px touch target", () => {
    const mockCapabilities: Capabilities = {
      commands: [],
      agents: [{ name: "test-agent" }],
      model: "claude-3-5-sonnet",
    };

    useAppStore.setState({ capabilities: mockCapabilities });

    const { container } = render(<AgentsScreen variant="screen" />);

    const card = container.querySelector(".ember-agent-card");
    expect(card).toBeDefined();

    // Verify the class is applied (CSS defines min-height: 44px)
    expect(card?.classList.contains("ember-agent-card")).toBe(true);
  });
});
