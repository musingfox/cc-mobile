/**
 * terminal-control.test.ts — the terminal_create / terminal_teardown reply shapes and error
 * mapping, pinned against a fake backend (no real pane, no WS).
 *
 * These assertions are the behaviour-preservation net for lifting the handlers
 * out of ws.ts: every reply and every error code below is what the inline
 * version produced.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentProfile,
  type AgentProfileSource,
  createAgentProfileSource,
} from "./agents/profiles";
import type { CreateSessionInput } from "./terminal-backend";
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
  const createSessionCalls: CreateSessionInput[] = [];
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

function profileSource(profiles: AgentProfile[]): AgentProfileSource {
  return { list: () => profiles };
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

describe("handleTerminalCreate — profile resolution", () => {
  it("resolves a known profile to its kind and argv", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTerminalCreate(
      { claudeUuid: "u1", cwd: "/tmp", profileId: "p-omp" },
      {
        backend,
        allowedRoots: null,
        send,
        agentProfiles: profileSource([
          {
            id: "p-omp",
            label: "omp ask",
            kind: "omp",
            args: ["--approval-mode", "always-ask"],
          },
        ]),
      },
    );

    expect(createSessionCalls).toEqual([
      {
        claudeUuid: "u1",
        cwd: "/tmp",
        agentKind: "omp",
        profileArgs: ["--approval-mode", "always-ask"],
      },
    ]);
    expect(sent[0]?.type).toBe("terminal_created");
  });

  it("keeps cached agentKind launches free of a profileArgs key", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send } = makeSendSpy();

    await handleTerminalCreate(
      { claudeUuid: "u1", cwd: "/tmp", agentKind: "omp" },
      { backend, allowedRoots: null, send },
    );

    expect(createSessionCalls).toEqual([{ claudeUuid: "u1", cwd: "/tmp", agentKind: "omp" }]);
    expect(Object.hasOwn(createSessionCalls[0] ?? {}, "profileArgs")).toBe(false);
  });

  it("refuses an invalid cwd before launching a known profile", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTerminalCreate(
      { claudeUuid: "u1", cwd: "/definitely/not/here", profileId: "p-omp" },
      {
        backend,
        allowedRoots: null,
        send,
        agentProfiles: profileSource([{ id: "p-omp", label: "omp ask", kind: "omp", args: [] }]),
      },
    );

    expect(sent[0]?.code).toBe("invalid_cwd");
    expect(createSessionCalls).toHaveLength(0);
  });
});

describe("handleTerminalCreate — selector validation", () => {
  it("rejects a request carrying both agentKind and profileId before creation", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTerminalCreate(
      { claudeUuid: "u1", cwd: "/tmp", agentKind: "omp", profileId: "p-omp" },
      {
        backend,
        allowedRoots: null,
        send,
        agentProfiles: profileSource([{ id: "p-omp", label: "omp ask", kind: "omp", args: [] }]),
      },
    );

    expect(sent).toEqual([
      {
        type: "error",
        code: "invalid_message",
        message: "agentKind and profileId are mutually exclusive",
      },
    ]);
    expect(createSessionCalls).toHaveLength(0);
  });
});

describe("handleTerminalCreate — unknown profiles", () => {
  it("refuses an unknown profile before session creation", async () => {
    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTerminalCreate(
      { claudeUuid: "u1", cwd: "/tmp", profileId: "nope" },
      { backend, allowedRoots: null, send, agentProfiles: profileSource([]) },
    );

    expect(sent[0]?.code).toBe("unknown_profile");
    expect(createSessionCalls).toHaveLength(0);
  });

  it("refuses a profile dropped because its binary is absent from PATH", async () => {
    const directory = mkdtempSync(join(testRoot, "profiles-"));
    const path = join(directory, "profiles.json");
    writeFileSync(path, JSON.stringify([{ id: "p-omp", label: "omp ask", kind: "omp", args: [] }]));

    // The empty PATH is held only across the synchronous load — list() is all
    // readFileSync/Bun.which — so no other test's async work can observe it.
    const originalPath = process.env.PATH;
    let loaded: AgentProfile[];
    try {
      process.env.PATH = "";
      loaded = createAgentProfileSource({ path }).list();
    } finally {
      process.env.PATH = originalPath;
      rmSync(directory, { recursive: true, force: true });
    }
    expect(loaded).toEqual([]);

    const { backend, createSessionCalls } = makeFakeBackend();
    const { send, sent } = makeSendSpy();

    await handleTerminalCreate(
      { claudeUuid: "u1", cwd: "/tmp", profileId: "p-omp" },
      { backend, allowedRoots: null, send, agentProfiles: profileSource(loaded) },
    );

    expect(sent[0]?.code).toBe("unknown_profile");
    expect(createSessionCalls).toHaveLength(0);
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
