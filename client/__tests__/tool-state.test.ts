import { describe, it, expect, beforeEach } from "bun:test";
import { useAppStore } from "../stores/app-store";

describe("Tool State Management", () => {
  beforeEach(() => {
    // Reset store before each test
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  it("T5: set active tool status", () => {
    const store = useAppStore.getState();

    store.addSession("s1", "/tmp");
    store.setActiveToolStatus("s1", { toolName: "Read", description: "Reading file" });

    const session = useAppStore.getState().sessions.get("s1");
    expect(session?.activeToolStatus).toEqual({ toolName: "Read", description: "Reading file" });
  });

  it("T6: clear active tool status", () => {
    const store = useAppStore.getState();

    store.addSession("s1", "/tmp");
    store.setActiveToolStatus("s1", { toolName: "Read", description: "Reading file" });
    store.setActiveToolStatus("s1", null);

    const session = useAppStore.getState().sessions.get("s1");
    expect(session?.activeToolStatus).toBeNull();
  });

  it("should not crash when setting tool status for non-existent session", () => {
    const store = useAppStore.getState();

    // Should not throw
    expect(() => {
      store.setActiveToolStatus("non-existent", { toolName: "Read", description: "test" });
    }).not.toThrow();
  });
});
