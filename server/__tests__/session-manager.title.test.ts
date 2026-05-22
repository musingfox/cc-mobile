import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

interface QueryCall {
  prompt: unknown;
  options: Record<string, unknown>;
}

const queryCalls: QueryCall[] = [];
let nextMessages: Array<Record<string, unknown>> = [];

// Mock the SDK before importing SessionManager. We capture every `query` call,
// then yield a controllable sequence of SDK messages so the generator advances
// through `system/init` and we can observe how `pendingTitle` is propagated and
// cleared.
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

// loadUserPlugins is read on first sendMessage — short-circuit it.
mock.module("../settings-loader", () => ({
  loadUserPlugins: async () => [],
}));

// Pull SessionManager AFTER mocks are set up.
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

describe("SessionManager pending title option", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    nextMessages = [];
  });

  afterEach(() => {
    queryCalls.length = 0;
  });

  test("first turn includes options.title; subsequent turns drop it", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await mgr.createSession("ws-1", "/cwd", noopCanUseTool, undefined, "MyTitle");

    nextMessages = [
      { type: "system", subtype: "init", session_id: "sdk-1" },
    ];
    await drain(mgr.sendMessage("ws-1", "hi"));

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].options.title).toBe("MyTitle");

    // Second turn should not carry the title forward.
    nextMessages = [];
    await drain(mgr.sendMessage("ws-1", "again"));
    expect(queryCalls).toHaveLength(2);
    expect("title" in queryCalls[1].options).toBe(false);
  });

  test("createSession without title omits options.title", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await mgr.createSession("ws-2", "/cwd", noopCanUseTool);

    nextMessages = [];
    await drain(mgr.sendMessage("ws-2", "hi"));

    expect(queryCalls).toHaveLength(1);
    expect("title" in queryCalls[0].options).toBe(false);
  });

  test("whitespace-only title is treated as absent", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await mgr.createSession("ws-3", "/cwd", noopCanUseTool, undefined, "   ");

    nextMessages = [];
    await drain(mgr.sendMessage("ws-3", "hi"));

    expect(queryCalls).toHaveLength(1);
    expect("title" in queryCalls[0].options).toBe(false);
  });

  test("resumed sessions never receive options.title", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await mgr.createSession("ws-4", "/cwd", noopCanUseTool, "resumed-uuid", "Ignored");

    nextMessages = [];
    await drain(mgr.sendMessage("ws-4", "hi"));

    expect(queryCalls).toHaveLength(1);
    expect("title" in queryCalls[0].options).toBe(false);
  });
});
