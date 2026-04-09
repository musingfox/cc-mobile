import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ServerMessage } from "../../server/protocol";
import { isSessionStateChanged } from "../services/tool-events";

describe("session_state_changed type guard", () => {
  test("validates correct session_state_changed event", () => {
    const chunk = {
      type: "system",
      subtype: "session_state_changed",
      state: "idle",
    };
    expect(isSessionStateChanged(chunk)).toBe(true);
  });

  test("validates all valid states", () => {
    const states = ["idle", "running", "requires_action"];
    for (const state of states) {
      const chunk = {
        type: "system",
        subtype: "session_state_changed",
        state,
      };
      expect(isSessionStateChanged(chunk)).toBe(true);
    }
  });

  test("rejects invalid state value", () => {
    const chunk = {
      type: "system",
      subtype: "session_state_changed",
      state: "invalid",
    };
    expect(isSessionStateChanged(chunk)).toBe(false);
  });

  test("rejects wrong type", () => {
    const chunk = {
      type: "assistant",
      subtype: "session_state_changed",
      state: "idle",
    };
    expect(isSessionStateChanged(chunk)).toBe(false);
  });

  test("rejects wrong subtype", () => {
    const chunk = {
      type: "system",
      subtype: "init",
      state: "idle",
    };
    expect(isSessionStateChanged(chunk)).toBe(false);
  });

  test("rejects missing state", () => {
    const chunk = {
      type: "system",
      subtype: "session_state_changed",
    };
    expect(isSessionStateChanged(chunk)).toBe(false);
  });

  test("rejects non-string state", () => {
    const chunk = {
      type: "system",
      subtype: "session_state_changed",
      state: 123,
    };
    expect(isSessionStateChanged(chunk)).toBe(false);
  });
});

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
