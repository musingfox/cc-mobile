import { describe, expect, test } from "bun:test";
import { HistoryMessageSchema, ServerMessage, SessionListItemSchema } from "./protocol";

describe("SessionListItemSchema", () => {
  test("TC1: Valid SessionListItem passes", () => {
    const input = {
      sdkSessionId: "abc",
      displayTitle: "Test",
      cwd: "/home",
      lastModified: 1234567890,
    };
    const result = SessionListItemSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("TC2: Missing required field fails", () => {
    const input = {
      sdkSessionId: "abc",
      cwd: "/home",
    };
    const result = SessionListItemSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test("TC3: Invalid type fails", () => {
    const input = {
      sdkSessionId: 123,
      displayTitle: "Test",
      cwd: "/home",
      lastModified: 1234567890,
    };
    const result = SessionListItemSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("HistoryMessageSchema", () => {
  test("TC4: Valid HistoryMessage user passes", () => {
    const input = {
      id: "123",
      role: "user",
      content: "Hello",
      timestamp: 1234567890,
    };
    const result = HistoryMessageSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("TC5: Invalid role fails", () => {
    const input = {
      id: "123",
      role: "system",
      content: "Test",
      timestamp: 1234567890,
    };
    const result = HistoryMessageSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("ServerMessage", () => {
  test("TC6: Valid session_list message passes", () => {
    const input = {
      type: "session_list",
      sessions: [
        {
          sdkSessionId: "a",
          displayTitle: "T",
          cwd: "/",
          lastModified: 123,
        },
      ],
    };
    const result = ServerMessage.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("TC7: Valid session_history message passes", () => {
    const input = {
      type: "session_history",
      sessionId: "s1",
      messages: [
        {
          id: "1",
          role: "user",
          content: "Hi",
          timestamp: 123,
        },
      ],
    };
    const result = ServerMessage.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("TC8: Empty arrays pass", () => {
    const input1 = {
      type: "session_list",
      sessions: [],
    };
    const result1 = ServerMessage.safeParse(input1);
    expect(result1.success).toBe(true);

    const input2 = {
      type: "session_history",
      sessionId: "s1",
      messages: [],
    };
    const result2 = ServerMessage.safeParse(input2);
    expect(result2.success).toBe(true);
  });

  test("TC9: Existing ServerMessage types still valid", () => {
    const input = {
      type: "error",
      code: "E1",
      message: "Test",
    };
    const result = ServerMessage.safeParse(input);
    expect(result.success).toBe(true);
  });
});
