import { describe, test, expect } from "bun:test";
import { extractTextFromChunk } from "../services/ws-service";

describe("extractTextFromChunk", () => {
  test("extracts text from assistant message with text blocks", () => {
    const chunk = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      },
    };
    expect(extractTextFromChunk(chunk)).toBe("Hello world");
  });

  test("returns null for assistant message with no text blocks", () => {
    const chunk = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
      },
    };
    expect(extractTextFromChunk(chunk)).toBeNull();
  });

  test("returns null for assistant message with empty content", () => {
    const chunk = {
      type: "assistant",
      message: { content: [] },
    };
    expect(extractTextFromChunk(chunk)).toBeNull();
  });

  test("returns null for system event", () => {
    const chunk = {
      type: "system",
      subtype: "init",
      cwd: "/tmp",
      session_id: "abc",
    };
    expect(extractTextFromChunk(chunk)).toBeNull();
  });

  test("returns null for result event", () => {
    const chunk = {
      type: "result",
      subtype: "success",
      result: "done",
      total_cost_usd: 0.01,
      num_turns: 1,
    };
    expect(extractTextFromChunk(chunk)).toBeNull();
  });

  test("returns null for rate_limit_event", () => {
    const chunk = {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed" },
    };
    expect(extractTextFromChunk(chunk)).toBeNull();
  });

  test("returns null for assistant with no message property", () => {
    const chunk = { type: "assistant" };
    expect(extractTextFromChunk(chunk)).toBeNull();
  });

  // T1: stream_event with text_delta returns delta text
  test("extracts text from stream_event with text_delta", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
    };
    expect(extractTextFromChunk(chunk)).toBe("Hello");
  });

  // T2: stream_event with thinking_delta returns null
  test("returns null for stream_event with thinking_delta", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "..." },
      },
    };
    expect(extractTextFromChunk(chunk)).toBeNull();
  });

  // T3: stream_event content_block_start returns null
  test("returns null for stream_event content_block_start", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    };
    expect(extractTextFromChunk(chunk)).toBeNull();
  });

  // T4: stream_event message_start returns null
  test("returns null for stream_event message_start", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "message_start",
        message: { id: "msg_123", role: "assistant" },
      },
    };
    expect(extractTextFromChunk(chunk)).toBeNull();
  });

  // T5: existing assistant message still works
  test("extracts text from existing assistant message format", () => {
    const chunk = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "complete message" }],
      },
    };
    expect(extractTextFromChunk(chunk)).toBe("complete message");
  });
});
