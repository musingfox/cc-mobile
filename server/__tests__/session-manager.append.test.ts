import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

interface QueryCall {
  prompt: unknown;
  options: Record<string, unknown>;
}

const queryCalls: QueryCall[] = [];
let nextMessages: Array<Record<string, unknown>> = [];

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mock(({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
    queryCalls.push({ prompt, options });
    const messages = nextMessages;
    nextMessages = [];
    return {
      async *[Symbol.asyncIterator]() {
        for (const msg of messages) {
          yield msg;
        }
      },
      close() {},
    } as unknown as AsyncIterable<unknown> & { close(): void };
  }),
}));

mock.module("../settings-loader", () => ({
  loadUserPlugins: async () => [],
}));

const { SessionManager } = await import("../session-manager");

const noopCanUseTool: CanUseTool = (async () => ({
  behavior: "allow" as const,
  updatedInput: {},
})) as unknown as CanUseTool;

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) {
    // consume
  }
}

/**
 * Extract the SDKUserMessage `message.content` blocks from the prompt captured
 * by the SDK mock. The prompt is either a string (legacy single-shot) or an
 * AsyncIterable<SDKUserMessage>; we always invoke through the generator path
 * when buffered appends exist or ContentBlock[] content is used.
 */
async function readOutgoingBlocks(prompt: unknown): Promise<unknown[]> {
  if (typeof prompt === "string") {
    return [{ type: "text", text: prompt }];
  }
  const iter = prompt as AsyncIterable<{ message: { content: unknown[] } }>;
  for await (const msg of iter) {
    return msg.message.content;
  }
  throw new Error("generator yielded nothing");
}

describe("SessionManager.appendUserMessage", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    nextMessages = [];
  });

  afterEach(() => {
    queryCalls.length = 0;
  });

  test("buffered appends prepend to next sendMessage and clear on send", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await mgr.createSession("ws-1", "/cwd", noopCanUseTool);

    mgr.appendUserMessage("ws-1", "first note");
    mgr.appendUserMessage("ws-1", "second note");

    await drain(mgr.sendMessage("ws-1", "the question"));

    expect(queryCalls).toHaveLength(1);
    const blocks = await readOutgoingBlocks(queryCalls[0].prompt);
    expect(blocks).toEqual([
      { type: "text", text: "first note" },
      { type: "text", text: "second note" },
      { type: "text", text: "the question" },
    ]);

    // Second turn — buffer should be empty so only the new content goes out.
    await drain(mgr.sendMessage("ws-1", "follow up"));
    expect(queryCalls).toHaveLength(2);
    const secondBlocks = await readOutgoingBlocks(queryCalls[1].prompt);
    // With no pending appends and string content, the prompt is passed as a
    // bare string (length-1 normalized array).
    expect(secondBlocks).toHaveLength(1);
    expect(secondBlocks[0]).toEqual({ type: "text", text: "follow up" });
  });

  test("appendUserMessage on missing session throws not-found", () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    expect(() => mgr.appendUserMessage("nope", "hi")).toThrow("Session nope not found");
  });

  test("51st append exceeds count cap, throws atomically", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await mgr.createSession("ws-2", "/cwd", noopCanUseTool);

    for (let i = 0; i < 50; i++) {
      mgr.appendUserMessage("ws-2", "x");
    }
    expect(() => mgr.appendUserMessage("ws-2", "x")).toThrow("append_buffer_full");

    // After the rejection the buffer should still hold exactly 50 entries.
    await drain(mgr.sendMessage("ws-2", "go"));
    const blocks = await readOutgoingBlocks(queryCalls[0].prompt);
    expect(blocks).toHaveLength(51); // 50 buffered + 1 new
  });

  test("byte cap rejects payload that would exceed 1MB", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await mgr.createSession("ws-3", "/cwd", noopCanUseTool);

    // Push a ~700KB text block, then try to push another ~400KB block.
    mgr.appendUserMessage("ws-3", "a".repeat(700_000));
    expect(() => mgr.appendUserMessage("ws-3", "b".repeat(400_000))).toThrow("append_buffer_full");

    // Image data also counts: try an image with > 1MB base64 data on a fresh session.
    await mgr.createSession("ws-4", "/cwd", noopCanUseTool);
    expect(() =>
      mgr.appendUserMessage("ws-4", [
        {
          type: "text",
          text: "small",
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "x".repeat(1_048_577),
          },
        },
      ]),
    ).toThrow("append_buffer_full");
  });

  test("ContentBlock[] append with image is prepended before new send content", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await mgr.createSession("ws-5", "/cwd", noopCanUseTool);

    mgr.appendUserMessage("ws-5", [
      { type: "text", text: "see attachment" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc" },
      },
    ]);

    await drain(mgr.sendMessage("ws-5", "what does this show?"));

    const blocks = await readOutgoingBlocks(queryCalls[0].prompt);
    expect(blocks).toEqual([
      { type: "text", text: "see attachment" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc" },
      },
      { type: "text", text: "what does this show?" },
    ]);
  });
});
