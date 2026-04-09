import { beforeEach, describe, expect, test } from "bun:test";
import { useAppStore } from "../stores/app-store";
import type { TerminalReason } from "./tool-events";

describe("TerminalReason integration with UsageData", () => {
  beforeEach(() => {
    // Reset store state
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  test("updateUsage stores terminal_reason in UsageData", () => {
    const store = useAppStore.getState();
    const sessionId = "test-session";

    // Create session
    store.addSession(sessionId, "/test");

    // Update usage with terminal_reason
    const terminalReason: TerminalReason = "max_turns";
    store.updateUsage(sessionId, {
      totalCost: 0.001,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
      turns: 5,
      durationMs: 1000,
      terminalReason,
    });

    // Verify it was stored
    const session = useAppStore.getState().sessions.get(sessionId);
    expect(session).toBeDefined();
    expect(session?.usage).toBeDefined();
    expect(session?.usage?.terminalReason).toBe("max_turns");
  });

  test("updateUsage works without terminal_reason", () => {
    const store = useAppStore.getState();
    const sessionId = "test-session-2";

    // Create session
    store.addSession(sessionId, "/test");

    // Update usage without terminal_reason
    store.updateUsage(sessionId, {
      totalCost: 0.001,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
      turns: 5,
      durationMs: 1000,
    });

    // Verify it was stored without error
    const session = useAppStore.getState().sessions.get(sessionId);
    expect(session).toBeDefined();
    expect(session?.usage).toBeDefined();
    expect(session?.usage?.terminalReason).toBeUndefined();
  });

  test("updateUsage with completed terminal_reason", () => {
    const store = useAppStore.getState();
    const sessionId = "test-session-3";

    // Create session
    store.addSession(sessionId, "/test");

    // Update usage with "completed" terminal_reason
    store.updateUsage(sessionId, {
      totalCost: 0.001,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
      turns: 5,
      durationMs: 1000,
      terminalReason: "completed",
    });

    // Verify it was stored
    const session = useAppStore.getState().sessions.get(sessionId);
    expect(session).toBeDefined();
    expect(session?.usage).toBeDefined();
    expect(session?.usage?.terminalReason).toBe("completed");
  });

  test("all TerminalReason values are valid in UsageData", () => {
    const allReasons: TerminalReason[] = [
      "blocking_limit",
      "rapid_refill_breaker",
      "prompt_too_long",
      "image_error",
      "model_error",
      "aborted_streaming",
      "aborted_tools",
      "stop_hook_prevented",
      "hook_stopped",
      "tool_deferred",
      "max_turns",
      "completed",
    ];

    const store = useAppStore.getState();

    allReasons.forEach((reason, index) => {
      const sessionId = `session-${index}`;
      store.addSession(sessionId, "/test");

      // Should not throw
      store.updateUsage(sessionId, {
        totalCost: 0.001,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 20,
        cacheCreationTokens: 10,
        turns: 5,
        durationMs: 1000,
        terminalReason: reason,
      });

      const session = useAppStore.getState().sessions.get(sessionId);
      expect(session?.usage?.terminalReason).toBe(reason);
    });
  });
});
