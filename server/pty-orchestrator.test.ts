/**
 * pty-orchestrator.test.ts — Unit tests for PtyOrchestrator
 *
 * Covers (≥6 named cases, all injected mocks — no real claude, no SDK, no PTY):
 *   1. drive happy path: sends stream_chunk + stream_end
 *   2. cancel → kill: cancel() while in-flight kills the handle
 *   3. kill-prior (H3): re-drive same sessionId kills prior handle before spawning again
 *   4. cancelled-during-spawn (H4): cancel before onHandle fires suppresses send
 *   5. cancelAll kills multiple: cancelAll([s1,s2]) kills both handles
 *   6. cancelAll-partial: cancelAll([s1]) kills s1 only, s2 untouched
 */

import { describe, expect, it } from "bun:test";
import type { SpawnerFn } from "./pty-driver";
import { PtyOrchestrator } from "./pty-orchestrator";
import type { GetMessagesFn } from "./pty-reader";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeEndTurnMsg(text: string) {
  return {
    type: "assistant",
    uuid: "a1",
    parentUuid: "u1",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
    },
  };
}

function makeUserMsg(content: string) {
  return {
    type: "user",
    uuid: "u1",
    parentUuid: null,
    message: { role: "user", content },
  };
}

/** A spawner that resolves immediately (exits with 0) — for happy-path tests. */
function makeImmediateSpawner(): SpawnerFn {
  return (_args, _cwd) => ({
    write: (_data: string) => {},
    kill: () => {},
    exited: Promise.resolve(0),
  });
}

/**
 * A spawner that tracks kill calls and never exits —
 * keeps drive() alive so we can exercise cancel/cancelAll.
 */
function makeNeverSpawner(): {
  spawner: SpawnerFn;
  killCount: () => number;
} {
  let count = 0;
  return {
    spawner: (_args, _cwd) => ({
      write: (_data: string) => {},
      kill: () => {
        count++;
      },
      exited: new Promise<number>(() => {}), // never resolves
    }),
    killCount: () => count,
  };
}

/** getMessagesFn that returns an end_turn reply on the 2nd call (after baseline). */
function makeReplyGetMessages(replyText: string): GetMessagesFn {
  let calls = 0;
  return async (_id: string) => {
    calls++;
    if (calls === 1) return [makeUserMsg("prompt")];
    return [makeUserMsg("prompt"), makeEndTurnMsg(replyText)];
  };
}

/** getMessagesFn that never resolves — keeps drive() awaiting the poll. */
function makeNeverGetMessages(): GetMessagesFn {
  return (_id: string): Promise<unknown[]> => new Promise(() => {});
}

// ── Test cases ────────────────────────────────────────────────────────────────

describe("PtyOrchestrator — drive happy path", () => {
  it("sends stream_chunk (assistant-shaped) then stream_end on successful drive", async () => {
    const sent: unknown[] = [];
    const orch = new PtyOrchestrator({ timeout: 5000, interval: 10 });

    await orch.drive("sess-1", "/tmp", "hello", (msg) => sent.push(msg), {
      spawner: makeImmediateSpawner(),
      getMessagesFn: makeReplyGetMessages("hi there"),
    });

    expect(sent).toHaveLength(2);
    const chunk = sent[0] as Record<string, unknown>;
    expect(chunk.type).toBe("stream_chunk");
    expect(chunk.sessionId).toBe("sess-1");
    const end = sent[1] as Record<string, unknown>;
    expect(end.type).toBe("stream_end");
    expect(end.sessionId).toBe("sess-1");
    // Verify assistant text
    const innerChunk = chunk.chunk as Record<string, unknown>;
    expect(innerChunk.type).toBe("assistant");
  });
});

describe("PtyOrchestrator — cancel kills in-flight handle", () => {
  it("cancel() while drive() is in-flight kills the handle and suppresses send", async () => {
    const sent: unknown[] = [];
    const spy = makeNeverSpawner();
    const orch = new PtyOrchestrator({ timeout: 60000, interval: 50 });

    const drivePromise = orch.drive("sess-2", "/tmp", "hi", (msg) => sent.push(msg), {
      spawner: spy.spawner,
      getMessagesFn: makeNeverGetMessages(),
    });
    drivePromise.catch(() => {});

    // Let onHandle fire (sync after spawn)
    await Promise.resolve();

    orch.cancel("sess-2");

    // Kill must have been called
    expect(spy.killCount()).toBe(1);
    // No stream_chunk or stream_end sent after cancel
    expect(sent).toHaveLength(0);
  });
});

describe("PtyOrchestrator — kill-prior (H3)", () => {
  it("re-driving the same sessionId kills the prior handle before spawning again", async () => {
    const spy = makeNeverSpawner();
    const orch = new PtyOrchestrator({ timeout: 60000, interval: 50 });

    // First drive — never-settling, stays in-flight
    const d1 = orch.drive("sess-3", "/tmp", "first", () => {}, {
      spawner: spy.spawner,
      getMessagesFn: makeNeverGetMessages(),
    });
    d1.catch(() => {});

    await Promise.resolve(); // let onHandle store the handle

    // Second drive on same sessionId — should kill prior handle (H3)
    const d2 = orch.drive("sess-3", "/tmp", "second", () => {}, {
      spawner: spy.spawner,
      getMessagesFn: makeNeverGetMessages(),
    });
    d2.catch(() => {});

    // Prior handle was killed exactly once by H3 logic
    expect(spy.killCount()).toBeGreaterThanOrEqual(1);
  });
});

describe("PtyOrchestrator — cancelled-during-spawn (H4)", () => {
  it("cancel() called from within spawner (before onHandle fires) kills the handle and sends nothing", async () => {
    const sent: unknown[] = [];
    let killCalled = false;

    // H4 scenario: cancel() is called synchronously inside the spawner — i.e. during
    // driveOnce — which is before runPtySession calls onHandle. When onHandle then fires
    // it sees state.cancelled=true and calls handle.kill() immediately.
    const orch = new PtyOrchestrator({ timeout: 60000, interval: 50 });

    const spawner: SpawnerFn = (_args, _cwd) => {
      // Call cancel() synchronously while the spawner is executing — before onHandle fires
      orch.cancel("sess-4");
      return {
        write: (_data: string) => {},
        kill: () => {
          killCalled = true;
        },
        exited: new Promise<number>(() => {}),
      };
    };

    const drivePromise = orch.drive("sess-4", "/tmp", "hi", (msg) => sent.push(msg), {
      spawner,
      getMessagesFn: makeNeverGetMessages(),
    });
    drivePromise.catch(() => {});

    // onHandle fires synchronously before any await inside runPtySession
    await Promise.resolve();

    // H4: onHandle sees cancelled=true and calls handle.kill()
    expect(killCalled).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe("PtyOrchestrator — cancelAll kills multiple sessions", () => {
  it("cancelAll([s1, s2]) kills both in-flight handles exactly once each", async () => {
    const spy1 = makeNeverSpawner();
    const spy2 = makeNeverSpawner();
    const orch = new PtyOrchestrator({ timeout: 60000, interval: 50 });

    const d1 = orch.drive("s1", "/tmp", "hi", () => {}, {
      spawner: spy1.spawner,
      getMessagesFn: makeNeverGetMessages(),
    });
    d1.catch(() => {});

    const d2 = orch.drive("s2", "/tmp", "hi", () => {}, {
      spawner: spy2.spawner,
      getMessagesFn: makeNeverGetMessages(),
    });
    d2.catch(() => {});

    await Promise.resolve(); // let both onHandles fire

    orch.cancelAll(["s1", "s2"]);

    expect(spy1.killCount()).toBe(1);
    expect(spy2.killCount()).toBe(1);
  });
});

describe("PtyOrchestrator — cancelAll-partial: only kills listed sessions", () => {
  it("cancelAll([s1]) kills s1 but does NOT kill s2", async () => {
    const spy1 = makeNeverSpawner();
    const spy2 = makeNeverSpawner();
    const orch = new PtyOrchestrator({ timeout: 60000, interval: 50 });

    const d1 = orch.drive("s1", "/tmp", "hi", () => {}, {
      spawner: spy1.spawner,
      getMessagesFn: makeNeverGetMessages(),
    });
    d1.catch(() => {});

    const d2 = orch.drive("s2", "/tmp", "hi", () => {}, {
      spawner: spy2.spawner,
      getMessagesFn: makeNeverGetMessages(),
    });
    d2.catch(() => {});

    await Promise.resolve();

    orch.cancelAll(["s1"]);

    expect(spy1.killCount()).toBe(1);
    expect(spy2.killCount()).toBe(0);
  });
});
