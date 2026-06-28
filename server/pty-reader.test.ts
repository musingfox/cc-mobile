/**
 * pty-reader.test.ts — Unit tests for pty-reader module
 *
 * Covers:
 *   - loadSessionHistory: filtering, shape, sessionStore injection
 *   - readLatestAssistantResponse: polling, end_turn detection, timeout rejection
 *   - runPtySession: write-before-poll ordering, return value
 *
 * All tests use injected mocks — no real filesystem, no SDK, no PTY.
 */

import { describe, expect, it } from "bun:test";
import type { SpawnerFn } from "./pty-driver";
import type { GetMessagesFn, SessionStore } from "./pty-reader";
import { loadSessionHistory, readLatestAssistantResponse, runPtySession } from "./pty-reader";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makeUserMsg(uuid: string, content: string, parentUuid: string | null = null) {
  return {
    type: "user",
    uuid,
    parentUuid,
    message: { role: "user", content },
  };
}

function makeToolUseMsg(uuid: string, parentUuid: string) {
  return {
    type: "assistant",
    uuid,
    parentUuid,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }],
      stop_reason: "tool_use",
    },
  };
}

function makeEndTurnMsg(uuid: string, parentUuid: string, text: string) {
  return {
    type: "assistant",
    uuid,
    parentUuid,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
    },
  };
}

function makeStore(messages: unknown[]): SessionStore {
  return { load: (_key: string) => messages };
}

// ── loadSessionHistory ──────────────────────────────────────────────────────

describe("loadSessionHistory", () => {
  it("returns {role, content} entries — no id, no timestamp", async () => {
    const messages = [makeUserMsg("u1", "hello"), makeEndTurnMsg("a1", "u1", "hi there")];
    const result = await loadSessionHistory("sess", { sessionStore: makeStore(messages) });

    expect(result.length).toBe(2);
    // Strict shape check: no extra keys
    expect(Object.keys(result[0])).toEqual(["role", "content"]);
    expect(Object.keys(result[1])).toEqual(["role", "content"]);
  });

  it("filters out tool_use-only assistant messages", async () => {
    const messages = [makeUserMsg("u1", "run it"), makeToolUseMsg("a1", "u1")];
    const result = await loadSessionHistory("sess", { sessionStore: makeStore(messages) });

    expect(result.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("includes end_turn assistant but not tool_use assistant", async () => {
    const messages = [
      makeUserMsg("u1", "question"),
      makeToolUseMsg("a-tool", "u1"),
      makeEndTurnMsg("a-text", "a-tool", "answer"),
    ];
    const result = await loadSessionHistory("sess", { sessionStore: makeStore(messages) });

    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ role: "user", content: "question" });
    expect(result[1]).toEqual({ role: "assistant", content: "answer" });
  });

  it("last entry is the end_turn assistant", async () => {
    const messages = [
      makeUserMsg("u1", "what?"),
      makeToolUseMsg("a1", "u1"),
      makeEndTurnMsg("a2", "a1", "final reply"),
    ];
    const result = await loadSessionHistory("sess", { sessionStore: makeStore(messages) });

    expect(result.at(-1)).toEqual({ role: "assistant", content: "final reply" });
  });

  it("returns only user when no end_turn assistant exists", async () => {
    const messages = [makeUserMsg("u1", "hi"), makeToolUseMsg("a1", "u1")];
    const result = await loadSessionHistory("sess", { sessionStore: makeStore(messages) });

    expect(result).toEqual([{ role: "user", content: "hi" }]);
  });

  it("returns empty array for empty store", async () => {
    const result = await loadSessionHistory("sess", { sessionStore: makeStore([]) });
    expect(result).toEqual([]);
  });

  it("skips tool_result user messages", async () => {
    const messages = [
      makeUserMsg("u1", "kick it off"),
      {
        type: "user",
        uuid: "u-tool-result",
        parentUuid: "u1",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "output" }],
        },
      },
      makeEndTurnMsg("a1", "u-tool-result", "done"),
    ];
    const result = await loadSessionHistory("sess", { sessionStore: makeStore(messages) });

    // tool_result user message filtered; human user + final assistant remain
    expect(result.filter((m) => m.role === "user")).toHaveLength(1);
    expect(result[0]).toEqual({ role: "user", content: "kick it off" });
  });

  it("handles multiple text blocks in content array", async () => {
    const messages = [
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: null,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "part one " },
            { type: "text", text: "part two" },
          ],
          stop_reason: "end_turn",
        },
      },
    ];
    const result = await loadSessionHistory("sess", { sessionStore: makeStore(messages) });

    expect(result).toEqual([{ role: "assistant", content: "part one part two" }]);
  });
});

// ── readLatestAssistantResponse ─────────────────────────────────────────────

describe("readLatestAssistantResponse", () => {
  it("resolves with text when end_turn present on first poll", async () => {
    const messages = [makeUserMsg("u1", "hi"), makeEndTurnMsg("a1", "u1", "immediate reply")];
    const getMessagesFn: GetMessagesFn = async () => messages;

    const result = await readLatestAssistantResponse("sess", null, {
      getMessagesFn,
      timeout: 1000,
      interval: 10,
    });

    expect(result).toBe("immediate reply");
  });

  it("resolves on 2nd poll when first has no end_turn", async () => {
    let pollCount = 0;
    const userMsg = makeUserMsg("u1", "hello");
    const getMessagesFn: GetMessagesFn = async () => {
      pollCount++;
      if (pollCount === 1) return [userMsg];
      return [userMsg, makeEndTurnMsg("a1", "u1", "second poll reply")];
    };

    const result = await readLatestAssistantResponse("sess", null, {
      getMessagesFn,
      timeout: 2000,
      interval: 10,
    });

    expect(result).toBe("second poll reply");
    expect(pollCount).toBe(2);
  });

  it("rejects with the string 'timeout' (not an Error) when no end_turn arrives", async () => {
    const getMessagesFn: GetMessagesFn = async () => [makeUserMsg("u1", "hi")];

    await expect(
      readLatestAssistantResponse("sess", null, {
        getMessagesFn,
        timeout: 50,
        interval: 10,
      }),
    ).rejects.toBe("timeout");
  });

  it("does not reject with an Error instance for timeout", async () => {
    const getMessagesFn: GetMessagesFn = async () => [];

    let caught: unknown;
    try {
      await readLatestAssistantResponse("sess", null, {
        getMessagesFn,
        timeout: 40,
        interval: 10,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe("timeout");
    expect(caught instanceof Error).toBe(false);
  });

  it("skips tool_use-only assistant when polling", async () => {
    let pollCount = 0;
    const getMessagesFn: GetMessagesFn = async () => {
      pollCount++;
      if (pollCount < 3) {
        return [makeUserMsg("u1", "hi"), makeToolUseMsg("a1", "u1")];
      }
      return [
        makeUserMsg("u1", "hi"),
        makeToolUseMsg("a1", "u1"),
        makeEndTurnMsg("a2", "a1", "finally here"),
      ];
    };

    const result = await readLatestAssistantResponse("sess", null, {
      getMessagesFn,
      timeout: 2000,
      interval: 10,
    });

    expect(result).toBe("finally here");
  });
});

// ── runPtySession ───────────────────────────────────────────────────────────

describe("runPtySession", () => {
  it("returns the assistant reply", async () => {
    // H3: baseline poll (call 1) sees no end_turn; call 2+ has the reply.
    // Stateful mock mirrors the multi-turn contract: new end_turns appear after driveOnce.
    let pollCount = 0;
    const spawner: SpawnerFn = (_args, _cwd) => ({ write: () => {} });
    const getMessagesFn: GetMessagesFn = async () => {
      pollCount++;
      if (pollCount === 1) return [makeUserMsg("u1", "test prompt")];
      return [makeUserMsg("u1", "test prompt"), makeEndTurnMsg("a1", "u1", "reply text")];
    };

    const result = await runPtySession("sess", "/cwd", "test prompt", {
      spawner,
      getMessagesFn,
      timeout: 2000,
      interval: 10,
    });

    expect(result).toBe("reply text");
  });

  it("calls write (driveOnce) before first poll", async () => {
    const order: string[] = [];

    const spawner: SpawnerFn = (_args, _cwd) => ({
      write: (_data: string) => {
        order.push("write");
      },
    });

    let pollCount = 0;
    const userMsg = makeUserMsg("u1", "prompt");
    const getMessagesFn: GetMessagesFn = async () => {
      order.push("poll");
      pollCount++;
      if (pollCount === 1) return [userMsg];
      return [userMsg, makeEndTurnMsg("a1", "u1", "done")];
    };

    await runPtySession("sess", "/cwd", "prompt", {
      spawner,
      getMessagesFn,
      timeout: 2000,
      interval: 10,
    });

    const firstWrite = order.indexOf("write");
    const firstPoll = order.indexOf("poll");
    expect(firstWrite).toBeGreaterThanOrEqual(0);
    expect(firstPoll).toBeGreaterThanOrEqual(0);
    expect(firstWrite).toBeLessThan(firstPoll);
  });

  it("sends prompt + CR to PTY", async () => {
    // H3: stateful mock — baseline call returns no end_turn; subsequent calls return reply.
    let pollCount = 0;
    const writtenData: string[] = [];
    const spawner: SpawnerFn = (_args, _cwd) => ({
      write: (data: string) => {
        writtenData.push(data);
      },
    });

    const getMessagesFn: GetMessagesFn = async () => {
      pollCount++;
      if (pollCount === 1) return [makeUserMsg("u1", "my question")];
      return [makeUserMsg("u1", "my question"), makeEndTurnMsg("a1", "u1", "answer")];
    };

    await runPtySession("sess", "/cwd", "my question", {
      spawner,
      getMessagesFn,
      timeout: 2000,
      interval: 10,
    });

    expect(writtenData[0]).toBe("my question\r");
  });

  it("uses the correct session-id in spawner args", async () => {
    // H3: stateful mock — baseline call returns no end_turn; subsequent calls return reply.
    let pollCount = 0;
    const capturedArgs: string[][] = [];
    const spawner: SpawnerFn = (args, _cwd) => {
      capturedArgs.push(args);
      return { write: () => {} };
    };

    const getMessagesFn: GetMessagesFn = async () => {
      pollCount++;
      if (pollCount === 1) return [];
      return [makeEndTurnMsg("a1", null as unknown as string, "ok")];
    };

    await runPtySession("target-sess-id", "/cwd", "hello", {
      spawner,
      getMessagesFn,
      timeout: 2000,
      interval: 10,
    });

    expect(capturedArgs[0]).toContain("--session-id");
    expect(capturedArgs[0]).toContain("target-sess-id");
  });

  it("C1: spawner args carry adjacent --permission-mode bypassPermissions (no settingsPath)", async () => {
    let pollCount = 0;
    const capturedArgs: string[][] = [];
    const spawner: SpawnerFn = (args, _cwd) => {
      capturedArgs.push(args);
      return { write: () => {} };
    };
    const getMessagesFn: GetMessagesFn = async () => {
      pollCount++;
      if (pollCount === 1) return [];
      return [makeEndTurnMsg("a1", null as unknown as string, "ok")];
    };

    await runPtySession("sess-id", "/cwd", "hello", {
      spawner,
      getMessagesFn,
      timeout: 2000,
      interval: 10,
    });

    const args = capturedArgs[0];
    const pmIdx = args.indexOf("--permission-mode");
    expect(pmIdx).toBeGreaterThanOrEqual(0);
    expect(args[pmIdx + 1]).toBe("bypassPermissions");
    expect(args).not.toContain("--settings");
  });

  it("C1: spawner args carry --permission-mode bypassPermissions plus --settings (with settingsPath)", async () => {
    let pollCount = 0;
    const capturedArgs: string[][] = [];
    const spawner: SpawnerFn = (args, _cwd) => {
      capturedArgs.push(args);
      return { write: () => {} };
    };
    const getMessagesFn: GetMessagesFn = async () => {
      pollCount++;
      if (pollCount === 1) return [];
      return [makeEndTurnMsg("a1", null as unknown as string, "ok")];
    };

    await runPtySession("sess-id", "/cwd", "hello", {
      spawner,
      getMessagesFn,
      settingsPath: "/tmp/some-settings.json",
      timeout: 2000,
      interval: 10,
    });

    const args = capturedArgs[0];
    const pmIdx = args.indexOf("--permission-mode");
    expect(pmIdx).toBeGreaterThanOrEqual(0);
    expect(args[pmIdx + 1]).toBe("bypassPermissions");
    expect(args).toContain("--settings");
    expect(args).toContain("/tmp/some-settings.json");
  });
});
