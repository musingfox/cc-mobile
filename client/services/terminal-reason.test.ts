import { describe, expect, test } from "bun:test";
import type { TerminalReason } from "./tool-events";
import { isResultMessage } from "./tool-events";
import { getTerminalReasonMessage } from "./ws-service";

describe("getTerminalReasonMessage", () => {
  test("returns null for completed", () => {
    expect(getTerminalReasonMessage("completed")).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(getTerminalReasonMessage(undefined)).toBeNull();
  });

  test("returns message for max_turns", () => {
    const message = getTerminalReasonMessage("max_turns");
    expect(message).toBeTruthy();
    expect(message).toContain("Maximum turns");
  });

  test("returns message for blocking_limit", () => {
    const message = getTerminalReasonMessage("blocking_limit");
    expect(message).toBeTruthy();
    expect(message).toContain("Rate limit");
  });

  test("returns message for rapid_refill_breaker", () => {
    const message = getTerminalReasonMessage("rapid_refill_breaker");
    expect(message).toBeTruthy();
    expect(message).toContain("Too many requests");
  });

  test("returns message for prompt_too_long", () => {
    const message = getTerminalReasonMessage("prompt_too_long");
    expect(message).toBeTruthy();
    expect(message).toContain("exceeds maximum length");
  });

  test("returns message for image_error", () => {
    const message = getTerminalReasonMessage("image_error");
    expect(message).toBeTruthy();
    expect(message).toContain("Image");
  });

  test("returns message for model_error", () => {
    const message = getTerminalReasonMessage("model_error");
    expect(message).toBeTruthy();
    expect(message).toContain("Model error");
  });

  test("returns message for aborted_streaming", () => {
    const message = getTerminalReasonMessage("aborted_streaming");
    expect(message).toBeTruthy();
    expect(message).toContain("aborted");
  });

  test("returns message for aborted_tools", () => {
    const message = getTerminalReasonMessage("aborted_tools");
    expect(message).toBeTruthy();
    expect(message).toContain("aborted");
  });

  test("returns message for stop_hook_prevented", () => {
    const message = getTerminalReasonMessage("stop_hook_prevented");
    expect(message).toBeTruthy();
    expect(message).toContain("prevented");
  });

  test("returns message for hook_stopped", () => {
    const message = getTerminalReasonMessage("hook_stopped");
    expect(message).toBeTruthy();
    expect(message).toContain("Hook stopped");
  });

  test("returns message for tool_deferred", () => {
    const message = getTerminalReasonMessage("tool_deferred");
    expect(message).toBeTruthy();
    expect(message).toContain("deferred");
  });

  test("all terminal reasons are handled", () => {
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

    for (const reason of allReasons) {
      // Should not throw
      const result = getTerminalReasonMessage(reason);
      // completed and undefined return null, others return messages
      if (reason === "completed") {
        expect(result).toBeNull();
      } else {
        expect(typeof result).toBe("string");
      }
    }
  });
});

describe("isResultMessage", () => {
  test("returns true for result message without terminal_reason", () => {
    const chunk = {
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 0.001,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    };
    expect(isResultMessage(chunk)).toBe(true);
  });

  test("returns true for result message with terminal_reason", () => {
    const chunk = {
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 0.001,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
      terminal_reason: "max_turns" as TerminalReason,
    };
    expect(isResultMessage(chunk)).toBe(true);
  });

  test("returns true for result message with completed terminal_reason", () => {
    const chunk = {
      type: "result",
      subtype: "success",
      is_error: false,
      terminal_reason: "completed" as TerminalReason,
    };
    expect(isResultMessage(chunk)).toBe(true);
  });

  test("returns false for non-result message", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
      },
    };
    expect(isResultMessage(chunk)).toBe(false);
  });

  test("returns false for message with wrong type", () => {
    const chunk = {
      type: "assistant",
      subtype: "success",
      is_error: false,
    };
    expect(isResultMessage(chunk)).toBe(false);
  });

  test("returns false for result without required fields", () => {
    const chunk = {
      type: "result",
      subtype: "success",
      // missing is_error
    };
    expect(isResultMessage(chunk)).toBe(false);
  });
});
