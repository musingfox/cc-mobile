/**
 * app-gate-harness.ts — drives the PRODUCTION composition root with the root
 * request gate's environment injected.
 *
 * `ws-harness.ts` cannot serve here: it builds `createWsPlugin` directly and so
 * never sees a gate installed on the root app. These helpers go through
 * `createApp` itself, with a spy backend (no daemon, no pane) and push paths in
 * a tmpdir (nothing lands in the developer's own `~/.claude-mobile`).
 *
 * Two ways in, because the two claims need different instruments:
 * `gatedApp` for port-free `handle()` assertions, and `listenGatedApp` for the
 * cases whose whole content is "no socket ever came into being", which only a
 * real handshake can witness.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppBackend, createApp } from "../app";
import { createSubscriptionStore } from "../push/subscription-store";
import { testServerConfig } from "./ws-harness";

/** Nothing on it is invoked while the gate is being exercised. */
const sessionManagerStub = {} as never;

function makeSpyBackend(): AppBackend {
  return {
    createSession: async () => ({ name: "", paneRef: "1" }),
    hasSession: () => ({ present: false }),
    listLive: () => [],
    teardown: async () => ({ killed: false }),
    teardownAll: async () => {},
    send: async () => {},
    registerClient: () => {},
    getClient: () => undefined,
    cleanupByOwner: () => {},
  };
}

const tmpDirs: string[] = [];

function pushPaths() {
  const dir = mkdtempSync(join(tmpdir(), "app-gate-push-"));
  tmpDirs.push(dir);
  return {
    pushStore: createSubscriptionStore({ path: join(dir, "subs.json") }),
    pushAttemptLogPath: join(dir, "attempts.jsonl"),
  };
}

/** Removes every tmpdir these helpers created. Call from an `afterAll`. */
export function cleanupGateHarness(): void {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * The assembled server, unlistened. Omit `gateEnv` entirely to let the gate
 * fall back to `process.env` — that is the production binding, and one test
 * pins it.
 */
export function gatedApp(gateEnv?: Record<string, string | undefined>) {
  return createApp(testServerConfig, {
    backend: makeSpyBackend(),
    sessionManager: sessionManagerStub,
    ...pushPaths(),
    ...(gateEnv ? { gateEnv } : {}),
  });
}

export interface ListenedGatedApp {
  port: number;
  /** Force-stops; a graceful stop outlives the test waiting on drained sockets. */
  close(): void;
}

/** The same app on an ephemeral port, for real-handshake assertions. */
export function listenGatedApp(gateEnv?: Record<string, string | undefined>): ListenedGatedApp {
  const app = gatedApp(gateEnv).listen(0);
  const server = app.server as { port: number; stop(force?: boolean): void } | null;
  if (!server) throw new Error("gated app failed to listen");
  return {
    port: server.port,
    close: () => server.stop(true),
  };
}
