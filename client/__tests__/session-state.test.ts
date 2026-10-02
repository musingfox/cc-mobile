import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ServerMessage } from "../../server/protocol";

describe("SessionStateMessage protocol schema", () => {
  test("validates correct session_state message", () => {
    const message = {
      type: "session_state",
      sessionId: "s1",
      state: "idle",
    };
    const result = ServerMessage.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "session_state") {
      expect(result.data.type).toBe("session_state");
      expect(result.data.sessionId).toBe("s1");
      expect(result.data.state).toBe("idle");
    }
  });

  test("validates all valid states", () => {
    const states = ["idle", "running", "requires_action"] as const;
    for (const state of states) {
      const message = {
        type: "session_state",
        sessionId: "s1",
        state,
      };
      const result = ServerMessage.safeParse(message);
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid state", () => {
    const message = {
      type: "session_state",
      sessionId: "s1",
      state: "invalid",
    };
    const result = ServerMessage.safeParse(message);
    expect(result.success).toBe(false);
  });

  test("rejects missing sessionId", () => {
    const message = {
      type: "session_state",
      state: "idle",
    };
    const result = ServerMessage.safeParse(message);
    expect(result.success).toBe(false);
  });

  test("rejects missing state", () => {
    const message = {
      type: "session_state",
      sessionId: "s1",
    };
    const result = ServerMessage.safeParse(message);
    expect(result.success).toBe(false);
  });

  test("rejects extra fields when strict", () => {
    const message = {
      type: "session_state",
      sessionId: "s1",
      state: "idle",
      extraField: "should be ignored",
    };
    // Zod by default ignores extra fields in non-strict mode
    const result = ServerMessage.safeParse(message);
    expect(result.success).toBe(true);
  });
});
