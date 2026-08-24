import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { type AppBackend, createApp } from "../app";
import { createSubscriptionStore } from "../push/subscription-store";
import { testServerConfig } from "./ws-harness";

const PANE = "w3V:p1";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpPaths() {
  const dir = mkdtempSync(join(tmpdir(), "app-audit-wiring-"));
  tmpDirs.push(dir);
  return {
    auditLogPath: join(dir, "audit.jsonl"),
    pushStore: createSubscriptionStore({ path: join(dir, "subs.json") }),
    pushAttemptLogPath: join(dir, "attempts.jsonl"),
  };
}

function spyBackend(): AppBackend {
  return {
    createSession: async () => ({ name: "", paneRef: "1" }),
    hasSession: () => ({ present: true, paneRef: PANE }),
    listLive: () => [],
    teardown: async () => ({ killed: false }),
    teardownAll: async () => {},
    send: async () => {},
    registerClient: () => {},
    getClient: () => undefined,
    cleanupByOwner: () => {},
  };
}

async function connect(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.onopen = () => resolve();
  socket.onerror = () => reject(new Error("websocket failed to open"));
  await promise;
  return socket;
}

function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

async function until(condition: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await yieldToEventLoop();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function records(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
function hasActions(path: string, actions: string[]): boolean {
  try {
    return JSON.stringify(records(path).map((record) => record.action)) === JSON.stringify(actions);
  } catch {
    return false;
  }
}

describe("AssembledServerAuditWiring", () => {
  test("a real WebSocket prompt writes exactly one prompt_send record", async () => {
    const paths = tmpPaths();
    const app = createApp(testServerConfig, { backend: spyBackend(), ...paths });
    app.listen(0);
    const server = app.server;
    if (!server || server.port === undefined) throw new Error("app failed to listen");
    const socket = await connect(server.port);
    try {
      socket.send(JSON.stringify({ type: "terminal_send", claudeUuid: PANE, content: "hi" }));
      await until(() => hasActions(paths.auditLogPath, ["prompt_send"]), "prompt audit line");
      expect(records(paths.auditLogPath).map((record) => record.action)).toEqual(["prompt_send"]);
    } finally {
      socket.close();
      server.stop(true);
    }
  });

  test("assembly and listen leave the audit path absent until an action occurs", () => {
    const paths = tmpPaths();
    const app = createApp(testServerConfig, { backend: spyBackend(), ...paths });
    app.listen(0);
    const server = app.server;
    if (!server || server.port === undefined) throw new Error("app failed to listen");
    try {
      expect(existsSync(paths.auditLogPath)).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});
