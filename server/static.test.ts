/**
 * static.test.ts — the static catch-all in `createApp`, driven through
 * `handle()` against a fixture dist under tmpdir.
 *
 * The case that matters is a missed asset: a hashed chunk a deploy removed
 * must come back 404, never index.html with status 200, because the service
 * worker stores whatever 200 it gets under the chunk's URL.
 *
 * A served file is told apart by status alone: the happy-dom preload replaces
 * the global `Response`, which reads a `Bun.file` body as "[object Blob]".
 * Only a fallback can turn a path with no file behind it into a 200.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testServerConfig } from "./__tests__/ws-harness";
import { type AppBackend, createApp } from "./app";
import { createSubscriptionStore } from "./push/subscription-store";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "static-test-"));
const DIST = join(TEST_ROOT, "client");
const INDEX_HTML = "<html>Test Index</html>";

mkdirSync(join(DIST, "assets"), { recursive: true });
writeFileSync(join(DIST, "index.html"), INDEX_HTML);
writeFileSync(join(DIST, "assets", "main.js"), "console.log('test');");

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

const spyBackend: AppBackend = {
  createSession: async () => ({ name: "", paneRef: "1" }),
  hasSession: () => ({ present: false }),
  listLive: () => [],
  teardown: async () => ({ killed: false }),
  teardownAll: async () => {},
  send: async () => ({ ok: true as const }),
  registerClient: () => {},
  getClient: () => undefined,
  cleanupByOwner: () => {},
};

const app = createApp(testServerConfig, {
  backend: spyBackend,
  sessionManager: {} as never,
  pushStore: createSubscriptionStore({ path: join(TEST_ROOT, "subs.json") }),
  pushAttemptLogPath: join(TEST_ROOT, "attempts.jsonl"),
  auditLogPath: join(TEST_ROOT, "audit.jsonl"),
  gateEnv: {},
  distDir: DIST,
});

const NAVIGATION_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

function get(path: string, accept = "*/*") {
  return app.handle(new Request(`http://localhost${path}`, { headers: { accept } }));
}

describe("Static file serving", () => {
  test("GET / serves index.html", async () => {
    const res = await get("/", NAVIGATION_ACCEPT);
    expect(res.status).toBe(200);
  });

  test("an existing asset is served as itself", async () => {
    const res = await get("/assets/main.js");
    expect(res.status).toBe(200);
  });

  test("a missing chunk requested by a script load is 404, not index.html", async () => {
    const res = await get("/assets/index-gone.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
    expect(await res.text()).not.toBe(INDEX_HTML);
  });

  test("a missing asset path is 404 even when the request accepts HTML", async () => {
    const res = await get("/assets/index-gone.js", NAVIGATION_ACCEPT);
    expect(res.status).toBe(404);
  });

  test("a navigation to an unknown extensionless path falls back to index.html", async () => {
    const res = await get("/some/route", NAVIGATION_ACCEPT);
    expect(res.status).toBe(200);
  });

  test("a non-navigation request for an unknown extensionless path is 404", async () => {
    const res = await get("/some/route");
    expect(res.status).toBe(404);
  });
});
