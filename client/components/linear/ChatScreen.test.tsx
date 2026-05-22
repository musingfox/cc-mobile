import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import ChatScreen from "./ChatScreen";

describe("ChatScreen", () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      capabilities: null,
      inputDraft: "",
    });
    useSettingsStore.setState({ permissionMode: "default" });
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

  test("renders user messages as right-aligned bubbles", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.loadSessionHistory("s1", [{ id: "m1", role: "user", content: "hi", timestamp: 0 }]);

    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    const userBubble = container.querySelector(".lin-msg--user");
    expect(userBubble).not.toBeNull();

    const css = readFileSync("client/components/linear/chat.css", "utf-8");
    expect(css.includes(".lin-msg--user {")).toBe(true);
    expect(css.includes("align-self: flex-end;")).toBe(true);
    expect(css.includes("background: #1f1f23;")).toBe(true);
    expect(css.includes("border-radius: 14px;")).toBe(true);
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

  test("C3c chip renders global default label with muted styling when no session override", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    useSettingsStore.setState({ permissionMode: "default" });

    const { getByLabelText } = render(<ChatScreen onNavigate={() => {}} />);
    const chip = getByLabelText("Permission mode") as HTMLButtonElement;
    expect(chip.textContent).toBe("Default");
    expect(chip.classList.contains("is-override")).toBe(false);
  });

  test("C3c chip renders override label with accent styling when session has override", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setSessionPermissionMode("s1", "plan");
    useSettingsStore.setState({ permissionMode: "default" });

    const { getByLabelText } = render(<ChatScreen onNavigate={() => {}} />);
    const chip = getByLabelText("Permission mode") as HTMLButtonElement;
    expect(chip.textContent).toBe("Plan");
    expect(chip.classList.contains("is-override")).toBe(true);
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

  test("shows thinking card when streaming starts before streamed content exists", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setStreaming("s1", true);

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    const card = container.querySelector(".lin-thinking");

    expect(card).not.toBeNull();
    expect(card?.classList.contains("lin-thinking--streaming")).toBe(false);
    expect(card?.classList.contains("lin-thinking--waiting")).toBe(false);
    expect(getByText("Thinking")).not.toBeNull();
  });

  test("shows streaming card when streamed assistant content is present", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setStreaming("s1", true);
    store.startStreamMessage("s1", "m1", "Hello");

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    const card = container.querySelector(".lin-thinking");

    expect(card?.classList.contains("lin-thinking--streaming")).toBe(true);
    expect(getByText("Streaming")).not.toBeNull();
  });

  test("shows waiting card when pending permission exists", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setPermission("s1", {
      requestId: "p1",
      tool: { name: "Bash", parameters: {} },
    });

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    const card = container.querySelector(".lin-thinking");

    expect(card?.classList.contains("lin-thinking--waiting")).toBe(true);
    expect(getByText("Waiting for permission")).not.toBeNull();
  });

  test("waiting permission state overrides streaming state", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setStreaming("s1", true);
    store.startStreamMessage("s1", "m1", "Hello");
    store.setPermission("s1", {
      requestId: "p1",
      tool: { name: "Bash", parameters: {} },
    });

    const { container, getByText } = render(<ChatScreen onNavigate={() => {}} />);
    const cards = container.querySelectorAll(".lin-thinking");

    expect(cards.length).toBe(1);
    expect(cards[0]?.classList.contains("lin-thinking--waiting")).toBe(true);
    expect(getByText("Waiting for permission")).not.toBeNull();
  });

  test("hides thinking card when not streaming and no permission is pending", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.loadSessionHistory("s1", [{ id: "m1", role: "assistant", content: "done", timestamp: 1 }]);

    const { container } = render(<ChatScreen onNavigate={() => {}} />);
    expect(container.querySelector(".lin-thinking")).toBeNull();
  });
});
