/**
 * ws-live-status-binding.test.ts — LiveSessionStatusBinding.
 *
 * A client's sink used to be installed only by terminal_send, so after a reload
 * the phone received no status events at all until the user typed something —
 * the spinner and the activity dot were dead until the next prompt. Asking for
 * the live session list now binds the sink too, which is the message every
 * client already sends on open.
 *
 * The gate on this behaviour is that it may not disturb reply recovery: the
 * five suites encoding those rules pass unmodified alongside these cases.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { EventBuffer } from "../event-buffer";
import { createWsPlugin, type WsBackend } from "../ws";
import { testServerConfig } from "./ws-harness";

type Sink = (msg: Record<string, unknown>) => void;

/**
 * Mirrors send-routing's ownership rules: one sink per uuid, last registration
 * wins, and a close reaps only the registrations that connection still owns.
 */
function recordingBackend(live: string[]) {
  const sinks = new Map<string, Sink>();
  const owners = new Map<string, unknown>();
  const registered: string[] = [];

  const backend: Partial<WsBackend> = {
    createSession: async () => ({ name: "n", paneRef: "p1", settingsPath: "/tmp/s" }),
    teardown: async () => ({ killed: false }),
    listLive: () => live,
    send: async () => {},
    registerClient: (claudeUuid, sink, owner) => {
      sinks.set(claudeUuid, sink);
      owners.set(claudeUuid, owner);
      registered.push(claudeUuid);
    },
    cleanupByOwner: (owner) => {
      for (const [claudeUuid, current] of [...owners]) {
        if (current !== owner) continue;
        sinks.delete(claudeUuid);
        owners.delete(claudeUuid);
      }
    },
  };

  return { backend, sinks, registered };
}

interface Conn {
  received: Record<string, unknown>[];
  send(message: unknown): void;
  waitFor(predicate: (msg: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/** One server, many connections — the reconnect cases need both to be real. */
async function startServer(backend: Partial<WsBackend>) {
  const { Elysia } = await import("elysia");
  const app = new Elysia()
    .use(
      createWsPlugin({} as never, testServerConfig, {
        backend: backend as WsBackend,
        terminalPermissionRelay: {
          requestPtyPermission: () => new Promise(() => {}),
          resolvePermission: () => {},
          getPendingCount: () => 0,
          hasPendingForSession: () => false,
          pausePending: () => [],
          resumePending: () => {},
        } as never,
        eventBuffer: new EventBuffer(500),
        clientSink: { current: null },
      }),
    )
    .listen(0);
  const port = (app.server as { port: number }).port;

  async function connect(): Promise<Conn> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const received: Record<string, unknown>[] = [];
    const listeners: ((msg: Record<string, unknown>) => void)[] = [];
    socket.onmessage = (event) => {
      const parsed = JSON.parse(String(event.data)) as Record<string, unknown>;
      received.push(parsed);
      for (const listener of [...listeners]) listener(parsed);
    };
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("failed to connect"));
    });

    return {
      received,
      send: (message) => socket.send(JSON.stringify(message)),
      waitFor(predicate) {
        const already = received.find(predicate);
        if (already) return Promise.resolve(already);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(`timed out; received: ${JSON.stringify(received.map((m) => m.type))}`),
              ),
            2000,
          );
          listeners.push((msg) => {
            if (!predicate(msg)) return;
            clearTimeout(timer);
            resolve(msg);
          });
        });
      },
      close: () =>
        new Promise<void>((resolve) => {
          socket.onclose = () => resolve();
          socket.close();
        }),
    };
  }

  return {
    connect,
    stop: () => (app.server as { stop(force?: boolean): void } | null)?.stop(true),
  };
}

let stopServer: (() => void) | null = null;

afterEach(() => {
  stopServer?.();
  stopServer = null;
});

describe("LiveSessionStatusBinding", () => {
  test("a status change reaches the client with no prompt ever sent", async () => {
    const { backend, sinks } = recordingBackend(["u1"]);
    const server = await startServer(backend);
    stopServer = server.stop;
    const conn = await server.connect();

    conn.send({ type: "list_terminal_sessions" });
    await conn.waitFor((msg) => msg.type === "terminal_sessions");

    // No terminal_send has happened — before this binding there was no sink at
    // all here, and the event went nowhere.
    sinks.get("u1")?.({ type: "session_state", sessionId: "u1", state: "running" });

    const event = await conn.waitFor((msg) => msg.type === "event");
    expect(event.sessionId).toBe("u1");
    expect(event.payload).toEqual({ type: "session_state", sessionId: "u1", state: "running" });

    await conn.close();
  });

  test("no live sessions registers nothing", async () => {
    const { backend, registered } = recordingBackend([]);
    const server = await startServer(backend);
    stopServer = server.stop;
    const conn = await server.connect();

    conn.send({ type: "list_terminal_sessions" });
    await conn.waitFor((msg) => msg.type === "terminal_sessions");

    expect(registered).toEqual([]);

    await conn.close();
  });

  test("after a reconnect the event follows the new connection, not the old one", async () => {
    const { backend, sinks } = recordingBackend(["u1"]);
    const server = await startServer(backend);
    stopServer = server.stop;

    const first = await server.connect();
    first.send({ type: "list_terminal_sessions" });
    await first.waitFor((msg) => msg.type === "terminal_sessions");
    await first.close();

    // The reply is sent after the registration loop, so waiting for it is the
    // barrier that the rebind has happened: one sink per uuid, last write wins.
    const second = await server.connect();
    second.send({ type: "list_terminal_sessions" });
    await second.waitFor((msg) => msg.type === "terminal_sessions");

    sinks.get("u1")?.({ type: "session_state", sessionId: "u1", state: "idle" });

    const event = await second.waitFor((msg) => msg.type === "event");
    expect(event.payload).toEqual({ type: "session_state", sessionId: "u1", state: "idle" });
    expect(first.received.some((msg) => msg.type === "event")).toBe(false);

    await second.close();
  });
});
