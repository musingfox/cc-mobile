import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearSessionState,
  getAllSessionIds,
  loadActiveSessionId,
  loadSessionState,
  saveActiveSessionId,
  saveSessionState,
} from "../services/session-persistence";
import type { SessionState } from "../stores/app-store";

describe("session-persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // TC-SP1: saveSessionState creates valid JSON in localStorage
  test("TC-SP1: saveSessionState creates valid localStorage entry", () => {
    const mockState: SessionState = {
      id: "sess-1",
      cwd: "/test",
      sdkSessionId: null,
      messages: [{ id: "m1", role: "user", content: "hello", timestamp: 123 }],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
    };

    saveSessionState("sess-1", mockState);

    const stored = localStorage.getItem("ccm:session:sess-1");
    expect(stored).not.toBeNull();

    // Verify it's valid JSON
    if (stored) {
      expect(() => JSON.parse(stored)).not.toThrow();
    }
  });

  // TC-SP2: loadSessionState after save returns matching state
  test("TC-SP2: saveSessionState + loadSessionState roundtrip", () => {
    const mockState: SessionState = {
      id: "sess-1",
      cwd: "/test",
      sdkSessionId: null,
      messages: [
        { id: "m1", role: "user", content: "hello", timestamp: 123 },
        { id: "m2", role: "assistant", content: "world", timestamp: 456 },
      ],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
    };

    saveSessionState("sess-1", mockState);
    const loaded = loadSessionState("sess-1");

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("sess-1");
    expect(loaded?.cwd).toBe("/test");
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.messages[0].content).toBe("hello");
    expect(loaded?.messages[1].content).toBe("world");
  });

  // TC-SP3: loadSessionState returns null for nonexistent
  test("TC-SP3: loadSessionState returns null for nonexistent session", () => {
    const loaded = loadSessionState("nonexistent");
    expect(loaded).toBeNull();
  });

  // TC-SP4: Map fields are correctly serialized/deserialized
  test("TC-SP4: Map fields (activeTools) are preserved", () => {
    const mockState: SessionState = {
      id: "sess-1",
      cwd: "/test",
      sdkSessionId: null,
      messages: [],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map([
        ["tool1", { toolName: "Read", startedAt: 1000 }],
        ["tool2", { toolName: "Write", startedAt: 2000 }],
      ]),
      activeAgents: new Map([["agent1", { description: "Test agent", status: "running" }]]),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
    };

    saveSessionState("sess-1", mockState);
    const loaded = loadSessionState("sess-1");

    expect(loaded).not.toBeNull();
    expect(loaded?.activeTools).toBeInstanceOf(Map);
    expect(loaded?.activeTools.size).toBe(2);
    expect(loaded?.activeTools.get("tool1")?.toolName).toBe("Read");
    expect(loaded?.activeTools.get("tool2")?.startedAt).toBe(2000);

    expect(loaded?.activeAgents).toBeInstanceOf(Map);
    expect(loaded?.activeAgents.size).toBe(1);
    expect(loaded?.activeAgents.get("agent1")?.description).toBe("Test agent");
  });

  // TC-SP5: getAllSessionIds with multiple sessions
  test("TC-SP5: getAllSessionIds returns all saved session IDs", () => {
    const mock1: SessionState = {
      id: "sess-1",
      cwd: "/test1",
      sdkSessionId: null,
      messages: [],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
    };

    const mock2: SessionState = {
      id: "sess-2",
      cwd: "/test2",
      sdkSessionId: null,
      messages: [],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
    };

    const mock3: SessionState = {
      id: "sess-3",
      cwd: "/test3",
      sdkSessionId: null,
      messages: [],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
    };

    saveSessionState("sess-1", mock1);
    saveSessionState("sess-2", mock2);
    saveSessionState("sess-3", mock3);

    const ids = getAllSessionIds();
    expect(ids).toHaveLength(3);
    expect(ids).toContain("sess-1");
    expect(ids).toContain("sess-2");
    expect(ids).toContain("sess-3");
  });

  // TC-SP6: saveActiveSessionId + loadActiveSessionId
  test("TC-SP6: active session ID persistence", () => {
    saveActiveSessionId("sess-2");
    const loaded = loadActiveSessionId();
    expect(loaded).toBe("sess-2");
  });

  // TC-SP7: Invalid JSON returns null without throwing
  test("TC-SP7: invalid JSON in localStorage returns null", () => {
    localStorage.setItem("ccm:session:broken", "{ invalid json");

    const loaded = loadSessionState("broken");
    expect(loaded).toBeNull();
  });

  // Additional: clearSessionState removes session
  test("clearSessionState removes session from storage and ID list", () => {
    const mockState: SessionState = {
      id: "sess-1",
      cwd: "/test",
      sdkSessionId: null,
      messages: [],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
    };

    saveSessionState("sess-1", mockState);
    expect(getAllSessionIds()).toContain("sess-1");

    clearSessionState("sess-1");

    expect(localStorage.getItem("ccm:session:sess-1")).toBeNull();
    expect(getAllSessionIds()).not.toContain("sess-1");
  });

  // Additional: saveActiveSessionId(null) removes the key
  test("saveActiveSessionId(null) removes active session", () => {
    saveActiveSessionId("sess-1");
    expect(loadActiveSessionId()).toBe("sess-1");

    saveActiveSessionId(null);
    expect(loadActiveSessionId()).toBeNull();
  });
});
