/**
 * tmux-control.test.ts — the tmux_create / tmux_teardown reply shapes and error
 * mapping, pinned against a fake backend (no real tmux, no WS).
 *
 * These assertions are the behaviour-preservation net for lifting the handlers
 * out of ws.ts: every reply and every error code below is what the inline
 * version produced.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTmuxCreate, handleTmuxTeardown, type TmuxControlBackend } from "./tmux-control";

// ── fixtures ─────────────────────────────────────────────────────────────────

const testRoot = join(realpathSync(tmpdir()), `tmux-control-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(testRoot, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

function makeFakeBackend(overrides: Partial<TmuxControlBackend> = {}) {
  const createSessionCalls: Array<{ claudeUuid: string; cwd: string }> = [];
  const teardownCalls: string[] = [];

  const backend: TmuxControlBackend = {
    createSession: async (params) => {
      createSessionCalls.push(params);
      return { name: "cc-u1", paneRef: "7", settingsPath: "/s" };
    },
    teardown: async (claudeUuid) => {
      teardownCalls.push(claudeUuid);
      return { killed: true };
    },
    ...overrides,
  };

  return { backend, createSessionCalls, teardownCalls };
}

function makeSendSpy() {
  const sent: Record<string, unknown>[] = [];
  return { send: (msg: Record<string, unknown>) => sent.push(msg), sent };
}

// ── handleTmuxCreate ─────────────────────────────────────────────────────────

describe("handleTmuxCreate — happy path", () => {
  it("creates the session and replies tmux_created with the backend name as tmuxName", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTmuxCreate(
      { claudeUuid: "u1", cwd: testRoot },
      { backend, allowedRoots: null, send },
    );

    expect(createSessionCalls).toEqual([{ claudeUuid: "u1", cwd: testRoot }]);
    expect(sent).toEqual([
      { type: "tmux_created", claudeUuid: "u1", tmuxName: "cc-u1", paneRef: "7" },
    ]);
  });

  it("expands a leading tilde before handing cwd to the backend", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send } = makeSendSpy();

    await handleTmuxCreate({ claudeUuid: "u1", cwd: "~" }, { backend, allowedRoots: null, send });

    expect(createSessionCalls[0]?.cwd).not.toBe("~");
    expect(createSessionCalls[0]?.cwd.startsWith("/")).toBe(true);
  });
});

describe("handleTmuxCreate — error mapping", () => {
  it("replies invalid_cwd and never reaches the backend for a missing path", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTmuxCreate(
      { claudeUuid: "u1", cwd: "/nonexistent-cc-mobile-xyz" },
      { backend, allowedRoots: null, send },
    );

    expect(sent).toEqual([
      {
        type: "error",
        code: "invalid_cwd",
        message: "Path does not exist: /nonexistent-cc-mobile-xyz",
      },
    ]);
    expect(createSessionCalls).toEqual([]);
  });

  it("replies path_not_allowed for a cwd outside the allowed roots", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTmuxCreate(
      { claudeUuid: "u1", cwd: testRoot },
      { backend, allowedRoots: ["/somewhere/else"], send },
    );

    expect(sent).toEqual([
      {
        type: "error",
        code: "path_not_allowed",
        message: "Project path is not in the allowed roots",
      },
    ]);
    expect(createSessionCalls).toEqual([]);
  });

  it("maps a backend rejection to tmux_error carrying the original message", async () => {
    const { backend } = makeFakeBackend({
      createSession: async () => {
        throw new Error("boom");
      },
    });
    const { send, sent } = makeSendSpy();

    await handleTmuxCreate(
      { claudeUuid: "u1", cwd: testRoot },
      { backend, allowedRoots: null, send },
    );

    expect(sent).toEqual([{ type: "error", code: "tmux_error", message: "boom" }]);
  });
});

// ── handleTmuxTeardown ───────────────────────────────────────────────────────

describe("handleTmuxTeardown", () => {
  it("replies tmux_teardown_result with killed:true", async () => {
    const { backend, teardownCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTmuxTeardown({ claudeUuid: "u1" }, { backend, send });

    expect(teardownCalls).toEqual(["u1"]);
    expect(sent).toEqual([{ type: "tmux_teardown_result", claudeUuid: "u1", killed: true }]);
  });

  it("reports killed:false for an unknown uuid without throwing", async () => {
    const { backend } = makeFakeBackend({ teardown: async () => ({ killed: false }) });
    const { send, sent } = makeSendSpy();

    await handleTmuxTeardown({ claudeUuid: "ghost" }, { backend, send });

    expect(sent).toEqual([{ type: "tmux_teardown_result", claudeUuid: "ghost", killed: false }]);
  });

  it("maps a backend rejection to tmux_error", async () => {
    const { backend } = makeFakeBackend({
      teardown: async () => {
        throw new Error("kill failed");
      },
    });
    const { send, sent } = makeSendSpy();

    await handleTmuxTeardown({ claudeUuid: "u1" }, { backend, send });

    expect(sent).toEqual([{ type: "error", code: "tmux_error", message: "kill failed" }]);
  });
});
