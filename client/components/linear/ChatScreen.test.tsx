import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useAppStore } from "../../stores/app-store";
import ChatScreen from "./ChatScreen";

describe("ChatScreen", () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      capabilities: null,
      inputDraft: "",
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("renders resumed user history messages with YOU label", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.loadSessionHistory("s1", [
      { id: "m1", role: "user", content: "hi", timestamp: 0 },
      { id: "m2", role: "assistant", content: "hello", timestamp: 1 },
    ]);

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    expect(getByText("YOU")).not.toBeNull();
    expect(getByText("CLAUDE")).not.toBeNull();
    expect(container.querySelector(".lin-msg--user .lin-msg-label")?.textContent).toBe("YOU");
  });

  test("slash button opens picker with commands", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setCapabilities({
      commands: [{ name: "clear", description: "Clear chat" }],
      agents: [],
      model: "claude-sonnet-4",
    });

    const { getByLabelText, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));

    expect(getByText("clear")).not.toBeNull();
    expect(getByText("Clear chat")).not.toBeNull();
  });

  test("selecting a command inserts literal into composer and closes picker", async () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setCapabilities({
      commands: [{ name: "clear", description: "Clear chat" }],
      agents: [],
      model: "claude-sonnet-4",
    });

    const { getByLabelText, getByText, queryByText } = render(<ChatScreen onNavigate={() => {}} />);
    fireEvent.click(getByLabelText("Insert slash command"));
    fireEvent.click(getByText("clear"));

    await waitFor(() => {
      expect(useAppStore.getState().inputDraft).toContain("/clear");
    });

    await waitFor(() => {
      expect(queryByText("Clear chat")).toBeNull();
    });
  });
});
