/**
 * hook-endpoints-removed.test.ts — HookEndpointsRemoved.
 *
 * cc-mobile used to make every claude it launched POST its Stop and PreToolUse
 * hooks back into this process: that is how replies were read and permissions
 * intercepted. Since #29 both come from herdr — replies from claude's transcript
 * file, permissions from the pane's own screen — which is what let the phone
 * drive a session the user started in their own terminal, where cc-mobile could
 * never have installed a hook.
 *
 * The HTTP surface must be gone, not merely unused: a stale settings file left
 * on disk from an old session will keep firing those POSTs, and a route that
 * still accepted them would resolve waiters nothing is listening to. This also
 * closes #28 — with no `/api/pty-response` route in the tree there is no startup
 * window in which a hook POST can be lost.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppBackend, createApp } from "../app";
import type { ServerConfig } from "../config";
import { createSubscriptionStore } from "../push/subscription-store";

const repoRoot = join(import.meta.dir, "..", "..");

const serverConfig: ServerConfig = {
  port: 3001,
  hostname: "127.0.0.1",
  defaultCwd: null,
  allowedRoots: null,
  pushScope: "phone-last" as const,
  basePath: "",
};

const backend = {
  createSession: async () => ({ name: "", paneRef: "1" }),
  hasSession: () => ({ present: false }),
  listLive: () => [],
  teardown: async () => ({ killed: false }),
  teardownAll: async () => {},
  send: async () => {},
  registerClient: () => {},
  getClient: () => undefined,
  cleanupByOwner: () => {},
} as AppBackend;

// Nothing here pushes, but a `createApp` with no push deps builds its store and
// its attempt log at the developer's own `~/.claude-mobile/`. A test suite has
// no business touching that directory at all.
const pushTmp = mkdtempSync(join(tmpdir(), "hook-endpoints-push-"));
const pushDeps = {
  pushStore: createSubscriptionStore({ path: join(pushTmp, "subs.json") }),
  pushAttemptLogPath: join(pushTmp, "attempts.jsonl"),
};

afterAll(() => {
  if (existsSync(pushTmp)) rmSync(pushTmp, { recursive: true, force: true });
});

function post(path: string, body: unknown): Request {
  return new Request(`http://127.0.0.1:3001${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("HookEndpointsRemoved", () => {
  test("a well-formed PreToolUse hook POST is not answered", async () => {
    const app = createApp(serverConfig, { backend, ...pushDeps });

    const response = await app.handle(
      post("/api/pty-permission", {
        session_id: "u1",
        tool_name: "Bash",
        tool_input: { command: "whoami" },
        tool_use_id: "toolu_01X",
      }),
    );

    expect(response.status).toBe(404);
  });

  test("a well-formed Stop hook POST is not answered", async () => {
    const app = createApp(serverConfig, { backend, ...pushDeps });

    const response = await app.handle(
      post("/api/pty-response", { session_id: "u1", text: "hello" }),
    );

    expect(response.status).toBe(404);
  });

  test.each([
    join("server", `claude${"-"}settings.ts`),
    join("server", `pty${"-"}stop-hook.ts`),
    join("server", `pty${"-"}permission-hook.ts`),
    join("server", `pty${"-"}response-relay.ts`),
    join("server", `pty${"-"}response-endpoint.ts`),
    join("server", `pty${"-"}permission-relay.ts`),
    join("server", `pty${"-"}permission-endpoint.ts`),
  ])("%s does not exist", (relative) => {
    expect(existsSync(join(repoRoot, relative))).toBe(false);
  });
});
