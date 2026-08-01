/**
 * tmux-lifecycle-wiring.test.ts — exercises the PRODUCTION composition root
 * (createApp) for tmux lifecycle wiring (no real tmux, no real signals sent,
 * no port bound).
 *
 *   EX-A2 (wiring): the tmuxPermissionRelay is constructed with timeoutMs=90000
 *                   (the unattended default), not the relay's 600000 fallback.
 *   EX-B2:          createApp registers SIGTERM + SIGINT handlers that call
 *                   backend.teardownAll(); repeated construction does NOT add
 *                   duplicate listeners (idempotency).
 *
 * These assertions used to point at createWsPlugin, which owned the assembly.
 * Assembly moved to createApp; the behaviour pinned here did not change.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { type AppBackend, createApp } from "./app";
import type { ServerConfig } from "./config";

// ── stubs ────────────────────────────────────────────────────────────────────

const serverConfig: ServerConfig = {
  port: 3001,
  hostname: "127.0.0.1",
  defaultCwd: null,
  permissionMode: "default",
  allowedRoots: null,
  basePath: "",
};

// Minimal SessionManager stub — nothing on it is invoked during assembly.
const sessionManagerStub = {
  updateCanUseTool: () => {},
} as any;

const permissionBridgeFactoryStub = (() => ({
  canUseTool: async () => ({ behavior: "allow" }),
  updateSendToClient: () => {},
  resumePending: () => {},
  pausePending: () => [],
})) as any;

function makeSpyBackend() {
  let teardownAllCalls = 0;
  const backend: AppBackend = {
    createSession: async () => ({ name: "", paneRef: "1", settingsPath: "" }),
    hasSession: () => ({ present: false }),
    teardown: async () => ({ killed: false }),
    teardownAll: async () => {
      teardownAllCalls++;
    },
    send: async () => {},
    registerClient: () => {},
    getClient: () => undefined,
    cleanupByOwner: () => {},
  };
  return {
    backend,
    get calls() {
      return teardownAllCalls;
    },
  };
}

// Capture the timeoutMs the production wiring passes into the tmux permission relay.
function makeRelayCapture() {
  let captured: number | undefined;
  const factory = (_send: any, opts: any = {}) => {
    captured = opts.timeoutMs;
    return {
      requestPtyPermission: () => new Promise(() => {}),
      resolvePermission: () => {},
      getPendingCount: () => 0,
      hasPendingForSession: () => false,
      pausePending: () => [],
      resumePending: () => {},
    };
  };
  return {
    factory: factory as any,
    get timeoutMs() {
      return captured;
    },
  };
}

function buildApp(extraDeps: Record<string, unknown>) {
  return createApp(serverConfig, {
    sessionManager: sessionManagerStub,
    permissionBridgeFactory: permissionBridgeFactoryStub,
    ...extraDeps,
  });
}

// Snapshot existing listeners so we leave the process as we found it.
const beforeSigterm = [...process.listeners("SIGTERM")];
const beforeSigint = [...process.listeners("SIGINT")];

afterAll(() => {
  for (const l of process.listeners("SIGTERM")) {
    if (!beforeSigterm.includes(l)) process.removeListener("SIGTERM", l as any);
  }
  for (const l of process.listeners("SIGINT")) {
    if (!beforeSigint.includes(l)) process.removeListener("SIGINT", l as any);
  }
});

// NOTE: EX-B2 runs first so the (process-global, one-shot) shutdown handler binds
// to its spy backend; the idempotency flag is then already set when EX-A2 runs,
// which is exactly what EX-A2 expects (it only inspects relay construction).

// ── EX-B2: SIGTERM/SIGINT teardown + idempotency ────────────────────────────────

describe("EX-B2: shutdown signal handlers call teardownAll, idempotently", () => {
  it("registers SIGTERM + SIGINT handlers that invoke backend.teardownAll, and repeated construction adds no duplicate listeners", () => {
    const spy = makeSpyBackend();

    const sigtermBase = process.listenerCount("SIGTERM");
    const sigintBase = process.listenerCount("SIGINT");

    // First construction registers the handlers (idempotency flag starts false in this file's process).
    buildApp({ backend: spy.backend });

    const sigtermAfter1 = process.listenerCount("SIGTERM");
    const sigintAfter1 = process.listenerCount("SIGINT");
    expect(sigtermAfter1).toBe(sigtermBase + 1);
    expect(sigintAfter1).toBe(sigintBase + 1);

    // Invoke the freshly-registered handlers (do NOT actually raise a signal).
    const newSigterm = process.listeners("SIGTERM").filter((l) => !beforeSigterm.includes(l));
    const newSigint = process.listeners("SIGINT").filter((l) => !beforeSigint.includes(l));
    for (const l of newSigterm) (l as any)();
    for (const l of newSigint) (l as any)();
    expect(spy.calls).toBeGreaterThanOrEqual(2);

    // Second construction must NOT add more listeners (idempotency).
    buildApp({ backend: makeSpyBackend().backend });
    expect(process.listenerCount("SIGTERM")).toBe(sigtermAfter1);
    expect(process.listenerCount("SIGINT")).toBe(sigintAfter1);
  });
});

// ── EX-A2 (wiring) ─────────────────────────────────────────────────────────────

describe("EX-A2 wiring: tmux permission relay timeout", () => {
  it("production wiring constructs the tmux permission relay with timeoutMs=90000 (not 600000)", () => {
    const relayCap = makeRelayCapture();
    buildApp({ backend: makeSpyBackend().backend, createTmuxPermissionRelay: relayCap.factory });
    expect(relayCap.timeoutMs).toBe(90000);
    expect(relayCap.timeoutMs).not.toBe(600000);
  });
});

// ── ComposableAppFactory: assembly without binding a port ──────────────────────

describe("createApp returns an unlistened app", () => {
  it("assembles the whole server without binding a port", () => {
    const app = buildApp({ backend: makeSpyBackend().backend });
    expect(typeof app.listen).toBe("function");
    expect(app.server).toBeFalsy();
  });
});
