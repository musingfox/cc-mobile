import { describe, expect, test } from "bun:test";
import { messagesFromProjectedChunk, projectChunk } from "../services/transcript-projection";

describe("projectChunk — which parts does this record project to", () => {
  test("assistant message with text blocks projects to one joined text part", () => {
    const chunk = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      },
    };
    expect(projectChunk(chunk)).toEqual([{ kind: "text", text: "Hello world" }]);
  });

  test("assistant message with no text blocks projects to a tool_use part (was null)", () => {
    const chunk = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
      },
    };
    expect(projectChunk(chunk)).toEqual([
      { kind: "tool_use", toolUseId: "t1", toolName: "Read", toolInput: {} },
    ]);
  });

  test("assistant message with empty content projects to no parts", () => {
    const chunk = {
      type: "assistant",
      message: { content: [] },
    };
    expect(projectChunk(chunk)).toEqual([]);
  });

  test("system event projects to no parts", () => {
    const chunk = {
      type: "system",
      subtype: "init",
      cwd: "/tmp",
      session_id: "abc",
    };
    expect(projectChunk(chunk)).toEqual([]);
  });

  test("result event projects to no parts", () => {
    const chunk = {
      type: "result",
      subtype: "success",
      result: "done",
      total_cost_usd: 0.01,
      num_turns: 1,
    };
    expect(projectChunk(chunk)).toEqual([]);
  });

  test("rate_limit_event projects to no parts", () => {
    const chunk = {
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed" },
    };
    expect(projectChunk(chunk)).toEqual([]);
  });

  test("assistant with no message property projects to no parts", () => {
    const chunk = { type: "assistant" };
    expect(projectChunk(chunk)).toEqual([]);
  });

  test("stream_event with text_delta projects to one text part", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
    };
    expect(projectChunk(chunk)).toEqual([]);
  });

  test("stream_event with thinking_delta projects to no parts", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "..." },
      },
    };
    expect(projectChunk(chunk)).toEqual([]);
  });

  test("stream_event content_block_start projects to no parts", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    };
    expect(projectChunk(chunk)).toEqual([]);
  });

  test("stream_event message_start projects to no parts", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "message_start",
        message: { id: "msg_123", role: "assistant" },
      },
    };
    expect(projectChunk(chunk)).toEqual([]);
  });

  test("existing assistant message format projects to one text part", () => {
    const chunk = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "complete message" }],
      },
    };
    expect(projectChunk(chunk)).toEqual([{ kind: "text", text: "complete message" }]);
  });

  test("user record text extraction (UserRecordBubble) projects to one text part", () => {
    const chunk = { type: "user", message: { role: "user", content: "from terminal" }, recordId: "u9", seq: 9 };
    expect(projectChunk(chunk as Record<string, unknown>)).toEqual([{ kind: "text", text: "from terminal" }]);
  });

  describe("no user bubble ever renders wrapper markup", () => {
    const wrapped = [
      "<command-name>/clear</command-name>",
      "<command-name>/compact</command-name>",
      "<local-command-stdout>ok</local-command-stdout>",
      "<local-command-stdout></local-command-stdout>",
      "<command-message>compact</command-message>\n<command-name>/compact</command-name>",
      "<command-name>/model</command-name>\n<command-args>opus</command-args>",
    ];

    for (const content of wrapped) {
      test(`string content: ${content.slice(0, 32)}`, () => {
        expect(projectChunk({ type: "user", message: { role: "user", content } })).toEqual([]);
      });

      test(`block content: ${content.slice(0, 32)}`, () => {
        expect(
          projectChunk({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: content }] },
          }),
        ).toEqual([]);
      });
    }

    test("a tool_result-only record projects to one tool_result part (was null)", () => {
      expect(
        projectChunk({
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", content: "42 lines" }] },
        }),
      ).toEqual([{ kind: "tool_result", toolUseId: "", text: "42 lines" }]);
    });

    test("ordinary text that merely mentions a slash command still projects to one text part", () => {
      expect(
        projectChunk({ type: "user", message: { role: "user", content: "run /clear for me" } }),
      ).toEqual([{ kind: "text", text: "run /clear for me" }]);
    });
  });

  test("assistant TRANSCRIPT RECORD with only a thinking block projects to one thinking part", () => {
    expect(
      projectChunk({
        type: "assistant",
        message: {
          content: [{ type: "thinking", thinking: "let me think", signature: "sig" }],
        },
      }),
    ).toEqual([{ kind: "thinking", thinking: "let me think", signature: "sig" }]);
  });

  test("thinking, tool_use, text, text join to [thinking, tool_use, text] in record order", () => {
    expect(
      projectChunk({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "plan" },
            { type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } },
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      }),
    ).toEqual([
      { kind: "thinking", thinking: "plan" },
      { kind: "tool_use", toolUseId: "t1", toolName: "Read", toolInput: { path: "a.ts" } },
      { kind: "text", text: "Hello world" },
    ]);
  });

  test("omp-shaped [thinking, text] in one record projects to separable parts", () => {
    expect(
      projectChunk({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "the answer" },
          ],
        },
      }),
    ).toEqual([
      { kind: "thinking", thinking: "hidden" },
      { kind: "text", text: "the answer" },
    ]);
  });

  test("unrecognised block type produces no part; others still project", () => {
    expect(
      projectChunk({
        type: "assistant",
        message: {
          content: [
            { type: "mystery", payload: true },
            { type: "text", text: "ok" },
          ],
        },
      }),
    ).toEqual([{ kind: "text", text: "ok" }]);
  });

  test("claude stop_reason end_turn survives on the text Message", () => {
    const msgs = messagesFromProjectedChunk(
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
      },
      () => "id-1",
      0,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].stopReason).toBe("end_turn");
  });

  test("omp stopReason stop survives on the text Message", () => {
    const msgs = messagesFromProjectedChunk(
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "done" }], stopReason: "stop" },
      },
      () => "id-1",
      0,
    );
    expect(msgs[0].stopReason).toBe("stop");
  });

  test("absence of stop_reason and stopReason leaves stopReason undefined with no throw", () => {
    const msgs = messagesFromProjectedChunk(
      { type: "assistant", message: { content: [{ type: "text", text: "done" }] } },
      () => "id-1",
      0,
    );
    expect(msgs[0].stopReason).toBeUndefined();
  });
});
