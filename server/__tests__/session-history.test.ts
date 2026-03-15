import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { loadSessionHistory } from "../session-history";

// Mock the SDK
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: mock(async (sessionId: string) => {
    return mockGetSessionMessagesImpl(sessionId);
  }),
}));

let mockGetSessionMessagesImpl: (sessionId: string) => Promise<SessionMessage[]>;

describe("session-history", () => {
  beforeEach(() => {
    mockGetSessionMessagesImpl = async () => [];
  });

  test("T4: extractMessageContent with content array", async () => {
    const mockMessages: SessionMessage[] = [
      {
        type: "user",
        uuid: "msg-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: " World" },
          ],
        },
      },
    ];

    mockGetSessionMessagesImpl = async () => mockMessages;

    const result = await loadSessionHistory("session-1");

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Hello World");
    expect(result[0].role).toBe("user");
    expect(result[0].id).toBe("msg-1");
  });

  test("T5: extractMessageContent with tool_use blocks (ignored)", async () => {
    const mockMessages: SessionMessage[] = [
      {
        type: "assistant",
        uuid: "msg-2",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", id: "t1", name: "Read" },
            { type: "text", text: "Some text" },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "msg-3",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          content: [{ type: "tool_use", id: "t2", name: "Write" }],
        },
      },
    ];

    mockGetSessionMessagesImpl = async () => mockMessages;

    const result = await loadSessionHistory("session-1");

    // msg-2 has text content, msg-3 should be filtered out (no text)
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Some text");
    expect(result[0].id).toBe("msg-2");
  });

  test("T6: extractMessageContent with string content field", async () => {
    const mockMessages: SessionMessage[] = [
      {
        type: "user",
        uuid: "msg-4",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "plain string content" },
      },
    ];

    mockGetSessionMessagesImpl = async () => mockMessages;

    const result = await loadSessionHistory("session-1");

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("plain string content");
  });

  test("filters out messages with empty content", async () => {
    const mockMessages: SessionMessage[] = [
      {
        type: "user",
        uuid: "msg-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "Valid" }] },
      },
      {
        type: "assistant",
        uuid: "msg-2",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { content: [] },
      },
      {
        type: "user",
        uuid: "msg-3",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {},
      },
    ];

    mockGetSessionMessagesImpl = async () => mockMessages;

    const result = await loadSessionHistory("session-1");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("msg-1");
    expect(result[0].content).toBe("Valid");
  });

  test("handles mixed content types", async () => {
    const mockMessages: SessionMessage[] = [
      {
        type: "user",
        uuid: "msg-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "string message" },
      },
      {
        type: "assistant",
        uuid: "msg-2",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "text", text: "Part 1" },
            { type: "tool_use", id: "t1", name: "Read" },
            { type: "text", text: " Part 2" },
          ],
        },
      },
    ];

    mockGetSessionMessagesImpl = async () => mockMessages;

    const result = await loadSessionHistory("session-1");

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("string message");
    expect(result[1].content).toBe("Part 1 Part 2");
  });
});
