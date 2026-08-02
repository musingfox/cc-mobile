/**
 * terminal-control.test.ts — the terminal_create / terminal_teardown reply shapes and error
 * mapping, pinned against a fake backend (no real pane, no WS).
 *
 * These assertions are the behaviour-preservation net for lifting the handlers
 * out of ws.ts: every reply and every error code below is what the inline
 * version produced.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleTerminalCreate,
  handleTerminalTeardown,
  type TerminalControlBackend,
} from "./terminal-control";

// ── fixtures ─────────────────────────────────────────────────────────────────

const testRoot = join(realpathSync(tmpdir()), `terminal-control-test-${Date.now()}`);

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

function makeFakeBackend(overrides: Partial<TerminalControlBackend> = {}) {
  const createSessionCalls: Array<{ claudeUuid: string; cwd: string }> = [];
  const teardownCalls: string[] = [];

  const backend: TerminalControlBackend = {
    createSession: async (params) => {
      createSessionCalls.push(params);
      return { name: "cc-u1", paneRef: "7" };
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

// ── handleTerminalCreate ─────────────────────────────────────────────────────────

describe("handleTerminalCreate — happy path", () => {
  it("creates the session and replies terminal_created with the backend name as terminalName", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTerminalCreate(
      { claudeUuid: "u1", cwd: testRoot },
      { backend, allowedRoots: null, send },
    );

    expect(createSessionCalls).toEqual([{ claudeUuid: "u1", cwd: testRoot }]);
    expect(sent).toEqual([
      {
        type: "terminal_created",
        claudeUuid: "u1",
        // The wire session key is the pane id; the request uuid only names the
        // buffer slot the ack was written into.
        sessionId: "7",
        terminalName: "cc-u1",
        paneRef: "7",
      },
    ]);
  });

  it("expands a leading tilde before handing cwd to the backend", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send } = makeSendSpy();

    await handleTerminalCreate(
      { claudeUuid: "u1", cwd: "~" },
      { backend, allowedRoots: null, send },
    );

    expect(createSessionCalls[0]?.cwd).not.toBe("~");
    expect(createSessionCalls[0]?.cwd.startsWith("/")).toBe(true);
  });
});

describe("handleTerminalCreate — error mapping", () => {
  it("replies invalid_cwd and never reaches the backend for a missing path", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTerminalCreate(
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

    await handleTerminalCreate(
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

  it("maps a backend rejection to terminal_error carrying the original message", async () => {
    const { backend } = makeFakeBackend({
      createSession: async () => {
        throw new Error("boom");
      },
    });
    const { send, sent } = makeSendSpy();

    await handleTerminalCreate(
      { claudeUuid: "u1", cwd: testRoot },
      { backend, allowedRoots: null, send },
    );

    expect(sent).toEqual([{ type: "error", code: "terminal_error", message: "boom" }]);
  });
});

// ── handleTerminalTeardown ───────────────────────────────────────────────────────

describe("handleTerminalTeardown", () => {
  it("replies terminal_teardown_result with killed:true", async () => {
    const { backend, teardownCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTerminalTeardown({ claudeUuid: "u1" }, { backend, send });

    expect(teardownCalls).toEqual(["u1"]);
    expect(sent).toEqual([
      { type: "terminal_teardown_result", sessionId: "u1", claudeUuid: "u1", killed: true },
    ]);
  });

  it("reports killed:false for an unknown uuid without throwing", async () => {
    const { backend } = makeFakeBackend({ teardown: async () => ({ killed: false }) });
    const { send, sent } = makeSendSpy();

    await handleTerminalTeardown({ claudeUuid: "ghost" }, { backend, send });

    expect(sent).toEqual([
      { type: "terminal_teardown_result", sessionId: "ghost", claudeUuid: "ghost", killed: false },
    ]);
  });

  it("refuses a session the user opened in their own terminal", async () => {
    const asked: string[] = [];
    const { backend } = makeFakeBackend({
      teardown: async (sessionId) => {
        asked.push(sessionId);
        return { killed: false, reason: "not_owned" as const };
      },
    });
    const { send, sent } = makeSendSpy();

    await handleTerminalTeardown({ sessionId: "w9:p1" }, { backend, send });

    // The refusal is the backend's (it issues no RPC); the handler's job is to
    // say why, so the card can stay and explain itself instead of vanishing.
    expect(asked).toEqual(["w9:p1"]);
    expect(sent).toEqual([
      {
        type: "error",
        code: "session_not_owned",
        sessionId: "w9:p1",
        message:
          "This session belongs to a terminal you opened yourself; cc-mobile will not close it.",
      },
    ]);
  });

  it("answers invalid_message when neither key is present", async () => {
    const { backend, teardownCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTerminalTeardown({}, { backend, send });

    expect(teardownCalls).toEqual([]);
    expect(sent[0]).toMatchObject({ type: "error", code: "invalid_message" });
  });

  it("maps a backend rejection to terminal_error", async () => {
    const { backend } = makeFakeBackend({
      teardown: async () => {
        throw new Error("kill failed");
      },
    });
    const { send, sent } = makeSendSpy();

    await handleTerminalTeardown({ claudeUuid: "u1" }, { backend, send });

    expect(sent).toEqual([{ type: "error", code: "terminal_error", message: "kill failed" }]);
  });
});
