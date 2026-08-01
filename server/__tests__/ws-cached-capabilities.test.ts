/**
 * ws-cached-capabilities.test.ts — CachedCapabilitiesStillEmittedOnConnect.
 *
 * The only writer of the capabilities cache lived on the SDK query path and is
 * gone (#25). The reader is not: a connection still ships whatever list is on
 * disk, and a machine with no cache file simply gets no list rather than an
 * error. That frozen state is the known consequence of the deletion (plan D3),
 * so it is pinned rather than left to be rediscovered as a bug.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../session-manager";
import { startWsHarness, testServerConfig, type WsHarness } from "./ws-harness";

const CACHE_DIR = join(homedir(), ".claude-mobile");
const CACHE_FILE = join(CACHE_DIR, "capabilities-cache.json");
const BACKUP_FILE = `${CACHE_FILE}.ws-cached-capabilities.backup`;

let harness: WsHarness | null = null;

const backendStub = {
  createSession: async () => ({ name: "n", paneRef: "p1", settingsPath: "/tmp/s" }),
  teardown: async () => ({ killed: false }),
  listLive: () => [],
  send: async () => {},
  registerClient: () => {},
  cleanupByOwner: () => {},
};

beforeEach(() => {
  if (existsSync(CACHE_FILE)) {
    writeFileSync(BACKUP_FILE, readFileSync(CACHE_FILE));
    rmSync(CACHE_FILE);
  }
});

afterEach(async () => {
  await harness?.close();
  harness = null;
  if (existsSync(CACHE_FILE)) rmSync(CACHE_FILE);
  if (existsSync(BACKUP_FILE)) {
    writeFileSync(CACHE_FILE, readFileSync(BACKUP_FILE));
    rmSync(BACKUP_FILE);
  }
});

/** Give the open handler's frame a moment to arrive. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("CachedCapabilitiesStillEmittedOnConnect", () => {
  test("a cache file on disk is emitted to a freshly-opened connection", async () => {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({ commands: [{ name: "/plan" }], agents: [], model: "sonnet" }),
      "utf-8",
    );

    harness = await startWsHarness(backendStub, testServerConfig, {
      sessionManager: new SessionManager({ permissionMode: "default" }),
    });

    const frame = await harness.waitFor((m) => m.type === "capabilities");
    expect(frame.commands).toEqual([{ name: "/plan" }]);
    expect(frame.model).toBe("sonnet");
  });

  test("no cache file: nothing is emitted and opening does not fail", async () => {
    expect(existsSync(CACHE_FILE)).toBe(false);

    harness = await startWsHarness(backendStub, testServerConfig, {
      sessionManager: new SessionManager({ permissionMode: "default" }),
    });
    await settle();

    expect(harness.received.filter((m) => m.type === "capabilities")).toEqual([]);

    // The connection is healthy — it answers a normal request.
    harness.send({ type: "get_server_config" });
    await harness.waitFor((m) => m.type === "server_config");
  });

  test("a corrupt cache file degrades to no capabilities rather than an open-time throw", async () => {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, "not json at all", "utf-8");

    harness = await startWsHarness(backendStub, testServerConfig, {
      sessionManager: new SessionManager({ permissionMode: "default" }),
    });
    await settle();

    expect(harness.received.filter((m) => m.type === "capabilities")).toEqual([]);
    harness.send({ type: "get_server_config" });
    await harness.waitFor((m) => m.type === "server_config");
  });
});
