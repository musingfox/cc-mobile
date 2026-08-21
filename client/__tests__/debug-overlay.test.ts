import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import DebugOverlay, { buildDebugStoreSnapshot, debugLog } from "../components/DebugOverlay";
import { useAppStore } from "../stores/app-store";

describe("DebugOverlay debugLog", () => {
  beforeEach(() => {
    debugLog.entries = [];
    debugLog.nextId = 0;
    debugLog.listeners.clear();
  });

  test("should add log entries with correct direction and type", () => {
    debugLog.add("send", { type: "new_session", cwd: "/test" });
    debugLog.add("recv", { type: "session_created", sessionId: "123" });

    expect(debugLog.entries.length).toBe(2);
    expect(debugLog.entries[0].direction).toBe("send");
    expect(debugLog.entries[0].type).toBe("new_session");
    expect(debugLog.entries[1].direction).toBe("recv");
    expect(debugLog.entries[1].type).toBe("session_created");
  });

  test("should limit entries to maxEntries (50)", () => {
    for (let i = 0; i < 60; i++) {
      debugLog.add("send", { type: "test", index: i });
    }

    expect(debugLog.entries.length).toBe(50);
    expect((debugLog.entries[0].data as { index: number }).index).toBe(10);
    expect((debugLog.entries[49].data as { index: number }).index).toBe(59);
  });

  test("should notify listeners when entries are added", () => {
    let callCount = 0;
    const listener = () => {
      callCount++;
    };

    const unsubscribe = debugLog.subscribe(listener);

    debugLog.add("send", { type: "test1" });
    debugLog.add("recv", { type: "test2" });

    expect(callCount).toBe(2);

    unsubscribe();
    debugLog.add("send", { type: "test3" });
    expect(callCount).toBe(2);
  });

  test("should handle non-object data gracefully", () => {
    debugLog.add("send", "plain string");
    debugLog.add("recv", null);
    debugLog.add("send", undefined);

    expect(debugLog.entries.length).toBe(3);
    expect(debugLog.entries[0].type).toBe("unknown");
    expect(debugLog.entries[1].type).toBe("unknown");
    expect(debugLog.entries[2].type).toBe("unknown");
  });

  test("should store timestamp for each entry", () => {
    const before = Date.now();
    debugLog.add("send", { type: "test" });
    const after = Date.now();

    expect(debugLog.entries[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(debugLog.entries[0].timestamp).toBeLessThanOrEqual(after);
  });

  test("should assign unique incremental IDs", () => {
    debugLog.add("send", { type: "test1" });
    debugLog.add("recv", { type: "test2" });
    debugLog.add("send", { type: "test3" });

    expect(debugLog.entries[0].id).toBe(0);
    expect(debugLog.entries[1].id).toBe(1);
    expect(debugLog.entries[2].id).toBe(2);
  });
});

describe("GlobalCapabilitiesSlotRemoved", () => {
  beforeEach(() => {
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  test("T1: the store has no machine-wide capabilities key", () => {
    expect("capabilities" in useAppStore.getState()).toBe(false);
  });

  test("T2: the store has no setCapabilities writer", () => {
    expect("setCapabilities" in useAppStore.getState()).toBe(false);
  });

  test("T3: debug snapshot carries the session status, not a top-level list", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    store.setSessionCapabilities("s1", { status: "ready", commands: [], agents: [] });
    const snapshot = buildDebugStoreSnapshot(useAppStore.getState());
    expect("capabilities" in snapshot).toBe(false);
    expect(snapshot.activeSession?.capabilities).toBe("ready");
  });

  test("T4: a session that never asked reports none", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    const snapshot = buildDebugStoreSnapshot(useAppStore.getState());
    expect(snapshot.activeSession?.capabilities).toBe("none");
  });

  test("T5: rendering the overlay does not throw", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    store.setActiveSession("s1");
    const url = new URL(window.location.href);
    url.searchParams.set("debug", "1");
    window.history.replaceState({}, "", url);
    expect(() => render(createElement(DebugOverlay))).not.toThrow();
  });
});
