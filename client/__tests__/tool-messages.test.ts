import { beforeEach, describe, expect, it } from "bun:test";
import { useAppStore } from "../stores/app-store";

describe("Tool Messages", () => {
  beforeEach(() => {
    // Reset store before each test
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  it("T7: add tool message", () => {
    const store = useAppStore.getState();

    store.addSession("s1", "/tmp");
    store.addToolMessage("s1", "Read", "Read 3 files from src/");

    const session = useAppStore.getState().sessions.get("s1");
    const lastMessage = session?.messages[session.messages.length - 1];

    expect(lastMessage?.role).toBe("tool");
    expect(lastMessage?.toolName).toBe("Read");
    expect(lastMessage?.content).toBe("Read 3 files from src/");
  });

  it("should generate unique message IDs", () => {
    const store = useAppStore.getState();

    store.addSession("s1", "/tmp");
    store.addToolMessage("s1", "Read", "First message");
    store.addToolMessage("s1", "Write", "Second message");

    const session = useAppStore.getState().sessions.get("s1");
    const ids = session?.messages.map((m) => m.id) ?? [];

    expect(new Set(ids).size).toBe(2); // All IDs should be unique
  });

  it("addToolMessage without attribution → message has no agent fields", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp");
    store.addToolMessage("s1", "Read", "summary");

    const session = useAppStore.getState().sessions.get("s1");
    const lastMessage = session?.messages[session.messages.length - 1];

    expect(lastMessage?.agentLabel).toBeUndefined();
    expect(lastMessage?.agentDescription).toBeUndefined();
  });

  it("addToolMessage with attribution → message carries agentLabel + agentDescription", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp");
    store.addToolMessage("s1", "Read", "summary", {
      agentLabel: "explore",
      agentDescription: "investigate bug",
    });

    const session = useAppStore.getState().sessions.get("s1");
    const lastMessage = session?.messages[session.messages.length - 1];

    expect(lastMessage?.agentLabel).toBe("explore");
    expect(lastMessage?.agentDescription).toBe("investigate bug");
  });

  it("should append tool messages to existing messages", () => {
    const store = useAppStore.getState();

    store.addSession("s1", "/tmp");
    store.addMessage("s1", {
      id: "user-1",
      role: "user",
      content: "Test message",
      timestamp: Date.now(),
    });
    store.addToolMessage("s1", "Read", "Tool summary");

    const session = useAppStore.getState().sessions.get("s1");
    expect(session?.messages.length).toBe(2);
    expect(session?.messages[0].role).toBe("user");
    expect(session?.messages[1].role).toBe("tool");
  });
});
