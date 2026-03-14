import { describe, test, expect } from "bun:test";
import { extractTextFromChunk } from "../hooks/useSocket";

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
});
