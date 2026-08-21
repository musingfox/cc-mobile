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

  // The terminal marker drives send routing, so it has to survive a reload.
  test("terminal marker survives the save/load roundtrip", () => {
    const mockState: SessionState = {
      id: "sess-term",
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
      contextUsage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
      terminal: { ready: true },
    };

    saveSessionState("sess-term", mockState);

    expect(loadSessionState("sess-term")?.terminal).toEqual({ ready: true });
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

  // RestoredSessionCarriesNoActivityClaim
  test("a reload brings back the conversation but never the activity", () => {
    // Written by an older bundle mid-turn: everything here claims the session
    // is busy. Only the server may say that, so a reload must not.
    localStorage.setItem(
      "ccm:session:u1",
      JSON.stringify({
        id: "u1",
        cwd: "/p",
        sdkSessionId: "sdk-1",
        messages: [{ id: "m1", role: "user", content: "hi", timestamp: 1 }],
        pendingPermission: { requestId: "r1" },
        isStreaming: true,
        currentStreamMessageId: "m1",
        activeToolStatus: null,
        activeTools: [],
        activeAgents: [],
        activeHook: null,
        usage: null,
        contextUsage: null,
        promptSuggestion: null,
        resolvedActions: [],
        agentState: "running",
        receivedAuthoritativeState: true,
        terminal: { ready: true },
      }),
    );

    const loaded = loadSessionState("u1");

    expect(loaded?.isStreaming).toBe(false);
    expect(loaded?.agentState).toBeNull();
    expect(loaded?.receivedAuthoritativeState).toBe(false);
    expect(loaded?.pendingPermission).toBeNull();
    expect(loaded?.currentStreamMessageId).toBeNull();
    // The content cache half is untouched.
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.cwd).toBe("/p");
    expect(loaded?.sdkSessionId).toBe("sdk-1");
    expect(loaded?.terminal).toEqual({ ready: true });
  });

  test("a payload without a terminal marker does not gain one on load", () => {
    localStorage.setItem(
      "ccm:session:u2",
      JSON.stringify({
        id: "u2",
        cwd: "/p",
        sdkSessionId: null,
        messages: [],
        pendingPermission: null,
        isStreaming: false,
        currentStreamMessageId: null,
        activeToolStatus: null,
        activeTools: [],
        activeAgents: [],
        activeHook: null,
        usage: null,
        contextUsage: null,
        promptSuggestion: null,
        resolvedActions: [],
        agentState: null,
        receivedAuthoritativeState: false,
      }),
    );

    // Send routing keys on this marker: inventing one would route a prompt
    // down a path the session never had.
    expect(loadSessionState("u2")?.terminal).toBeUndefined();
  });

  // LocalOnlyDiscardOnFirstPage T5 — the reload half.
  //
  // Without the epoch, every reload would look exactly like a rotation, and the
  // first history page after it would destroy the restored conversation instead
  // of merging into it. The paging cursor is deliberately not carried: it would
  // have to be re-validated against a file that may have rotated while the app
  // was closed, and an absent cursor self-heals on the next activation fetch.
  test("a reloaded session carries its transcript epoch, and not its paging cursor", () => {
    const state = {
      id: "u3",
      cwd: "/test",
      sdkSessionId: null,
      messages: [
        { id: "m1", role: "assistant" as const, content: "hi", timestamp: 1, recordId: "r1", seq: 10 },
      ],
      pendingPermission: null,
      isStreaming: false,
      currentStreamMessageId: null,
      activeToolStatus: null,
      activeTools: new Map(),
      activeAgents: new Map(),
      activeHook: null,
      usage: null,
      contextUsage: null,
      promptSuggestion: null,
      resolvedActions: [],
      agentState: null,
      receivedAuthoritativeState: false,
      epoch: "aaaa",
      pagingCursor: { epoch: "aaaa", seq: 400, recordId: "u9" },
    } as unknown as SessionState;

    saveSessionState("u3", state);

    const restored = loadSessionState("u3");
    expect(restored?.epoch).toBe("aaaa");
    expect(restored?.pagingCursor).toBeUndefined();

    const stored = JSON.parse(localStorage.getItem("ccm:session:u3") ?? "{}");
    expect(stored.epoch).toBe("aaaa");
    expect("pagingCursor" in stored).toBe(false);
  });

  // SessionRemovalDropsReplayCursor — the storage half of the choke point.
  test("clearing a session also forgets its replay cursor", () => {
    localStorage.setItem("ccm:lastEventIds", JSON.stringify({ u1: 5, u2: 9 }));

    clearSessionState("u2");

    expect(JSON.parse(localStorage.getItem("ccm:lastEventIds") ?? "{}")).toEqual({ u1: 5 });
  });
  describe("TranscriptPartsNotPersisted", () => {
    function base(messages: SessionState["messages"]): SessionState {
      return {
        id: "sess-parts",
        cwd: "/test",
        sdkSessionId: null,
        messages,
        pendingPermission: null,
        isStreaming: false,
        currentStreamMessageId: null,
        activeToolStatus: null,
        activeTools: new Map(),
        activeAgents: new Map(),
        activeHook: null,
        usage: null,
        contextUsage: null,
        promptSuggestion: null,
        resolvedActions: [],
        agentState: null,
        receivedAuthoritativeState: false,
      };
    }

    const mixed: SessionState["messages"] = [
      { id: "u", role: "user", content: "hi", timestamp: 1, recordId: "r-u", seq: 10 },
      { id: "th", role: "assistant", content: "plan", timestamp: 2, recordId: "r-a", seq: 20, blockIndex: 0, kind: "thinking" },
      { id: "tu", role: "assistant", content: "", timestamp: 2, recordId: "r-a", seq: 20, blockIndex: 1, kind: "tool_use", toolName: "Read" },
      { id: "tx", role: "assistant", content: "done", timestamp: 2, recordId: "r-a", seq: 20, blockIndex: 2, stopReason: "end_turn" },
    ];

    test("T1: localStorage JSON contains only the two text messages", () => {
      saveSessionState("sess-parts", base(mixed));
      const stored = JSON.parse(localStorage.getItem("ccm:session:sess-parts") ?? "{}");
      expect(stored.messages.map((m: { id: string }) => m.id)).toEqual(["u", "tx"]);
      expect(stored.messages.some((m: { kind?: string }) => m.kind === "thinking" || m.kind === "tool_use")).toBe(false);
    });

    test("T2: restore keeps the two text messages in order with recordId/seq/stopReason", () => {
      saveSessionState("sess-parts", base(mixed));
      const loaded = loadSessionState("sess-parts");
      expect(loaded?.messages.map((m) => m.id)).toEqual(["u", "tx"]);
      expect(loaded?.messages[0].recordId).toBe("r-u");
      expect(loaded?.messages[0].seq).toBe(10);
      expect(loaded?.messages[1].recordId).toBe("r-a");
      expect(loaded?.messages[1].seq).toBe(20);
      expect(loaded?.messages[1].stopReason).toBe("end_turn");
    });

    test("T3: local-only messages with no recordId all persist", () => {
      const locals: SessionState["messages"] = [
        { id: "l1", role: "user", content: "a", timestamp: 1 },
        { id: "l2", role: "assistant", content: "b", timestamp: 2 },
      ];
      saveSessionState("sess-parts", base(locals));
      expect(loadSessionState("sess-parts")?.messages.map((m) => m.id)).toEqual(["l1", "l2"]);
    });

    test("T5: older payload that already contains tool/thinking is filtered on load", () => {
      localStorage.setItem(
        "ccm:session:sess-parts",
        JSON.stringify({
          id: "sess-parts",
          cwd: "/test",
          sdkSessionId: null,
          messages: mixed,
          pendingPermission: null,
          isStreaming: false,
          currentStreamMessageId: null,
          activeToolStatus: null,
          activeTools: [],
          activeAgents: [],
          activeHook: null,
          usage: null,
          promptSuggestion: null,
          resolvedActions: [],
          agentState: null,
          receivedAuthoritativeState: false,
        }),
      );
      const loaded = loadSessionState("sess-parts");
      expect(loaded?.messages.map((m) => m.id)).toEqual(["u", "tx"]);
    });
  });
});
