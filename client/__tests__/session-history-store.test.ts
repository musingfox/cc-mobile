import { beforeEach, describe, expect, test } from "bun:test";
import { useAppStore } from "../stores/app-store";

describe("session history loading", () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  test("loadSessionHistory replaces session messages", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp");
    store.loadSessionHistory("s1", [
      { id: "h1", role: "user", content: "Hello", timestamp: 1000 },
      { id: "h2", role: "assistant", content: "Hi there", timestamp: 2000 },
    ]);
    const session = useAppStore.getState().sessions.get("s1");
    expect(session?.messages).toHaveLength(2);
    expect(session?.messages[0].content).toBe("Hello");
    expect(session?.messages[0].role).toBe("user");
    expect(session?.messages[1].content).toBe("Hi there");
  });

  test("loadSessionHistory with nonexistent session is no-op", () => {
    const store = useAppStore.getState();
    store.loadSessionHistory("nonexistent", [
      { id: "h1", role: "user", content: "Hello", timestamp: 1000 },
    ]);
    // No crash, no side effects
    expect(useAppStore.getState().sessions.size).toBe(0);
  });

  test("setSessionList stores session list", () => {
    const store = useAppStore.getState();
    store.setSessionList([
      {
        sdkSessionId: "sdk-1",
        displayTitle: "Test session",
        cwd: "/tmp/test",
        lastModified: Date.now(),
      },
    ]);
    expect(useAppStore.getState().sessionList).toHaveLength(1);
    expect(useAppStore.getState().sessionList[0].displayTitle).toBe("Test session");
  });
});
