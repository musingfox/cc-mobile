/**
 * app-lifecycle-wiring.test.ts — exercises the PRODUCTION composition root
 * (createApp) for terminal lifecycle wiring (no real pane, no real signals sent,
 * no port bound).
 *
 *   EX-B2: createApp registers NO shutdown signal handler and never calls
 *          backend.teardownAll() — panes outlive a SIGTERM, and the next startup
 *          finds them again by asking the daemon (plan D2). This inverts the
 *          original EX-B2, which pinned the opposite.
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
  allowedRoots: null,
  basePath: "",
};

// Minimal SessionManager stub — nothing on it is invoked during assembly.
const sessionManagerStub = {} as any;

function makeSpyBackend() {
  let teardownAllCalls = 0;
  const backend: AppBackend = {
    createSession: async () => ({ name: "", paneRef: "1" }),
    hasSession: () => ({ present: false }),
    listLive: () => [],
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

function buildApp(extraDeps: Record<string, unknown>) {
  return createApp(serverConfig, {
    sessionManager: sessionManagerStub,
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

// ── EX-B2: shutdown leaves panes alone ──────────────────────────────────────────

describe("EX-B2: shutdown signals do not tear down panes", () => {
  it("registers no SIGTERM/SIGINT handler and never calls backend.teardownAll, on first or repeated construction", () => {
    const spy = makeSpyBackend();

    const sigtermBase = process.listenerCount("SIGTERM");
    const sigintBase = process.listenerCount("SIGINT");

    buildApp({ backend: spy.backend });

    expect(process.listenerCount("SIGTERM")).toBe(sigtermBase);
    expect(process.listenerCount("SIGINT")).toBe(sigintBase);
    expect(spy.calls).toBe(0);

    // Repeated construction must not sneak a handler back in either.
    const spy2 = makeSpyBackend();
    buildApp({ backend: spy2.backend });
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBase);
    expect(process.listenerCount("SIGINT")).toBe(sigintBase);
    expect(spy2.calls).toBe(0);

    // Raising the signals would kill the test process, so instead assert the
    // stronger structural fact: no listener createApp added exists to invoke.
    const addedSigterm = process.listeners("SIGTERM").filter((l) => !beforeSigterm.includes(l));
    const addedSigint = process.listeners("SIGINT").filter((l) => !beforeSigint.includes(l));
    expect(addedSigterm).toEqual([]);
    expect(addedSigint).toEqual([]);
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
