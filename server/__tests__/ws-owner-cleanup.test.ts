/**
 * ws-owner-cleanup.test.ts — a closed connection's sink bindings are reaped.
 *
 * `close` used to hand `cleanupByOwner` the ElysiaWS wrapper it was given, but
 * Elysia builds a fresh wrapper per callback, so the lookup missed every time:
 * the owner map kept one dead entry (and the socket behind it) per connection,
 * forever. Since asking for the live session list now binds sinks, that is once
 * per connection — and a phone reconnects on every foreground/background cycle.
 *
 * The fake below mirrors send-routing's ownership rules exactly, object-keyed
 * `Map` included, because the reference comparison IS the bug under test.
 *
 * Deliberately scoped to the leak: the sink itself survives the close. It is
 * buffer-first and carries permission_request as well as replies, so dropping it
 * would silently turn a prompt arriving mid-outage into a 90s auto-deny.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { emptyAgentProfileSource } from "../agents/profiles";
import { EventBuffer } from "../event-buffer";
import { createWsPlugin, type WsBackend } from "../ws";
import { testServerConfig } from "./ws-harness";

type Sink = (msg: Record<string, unknown>) => void;

function ownerTrackingBackend(live: string[]) {
  const sinks = new Map<string, Sink>();
  const ownerToUuids = new Map<unknown, Set<string>>();
  const uuidToOwner = new Map<string, unknown>();
  const owners: { registered: unknown[]; cleaned: unknown[] } = { registered: [], cleaned: [] };

  const backend: Partial<WsBackend> = {
    listLive: () => live,
    send: async () => {},
    registerClient: (claudeUuid, sink, owner) => {
      owners.registered.push(owner);
      sinks.set(claudeUuid, sink);
      const prev = uuidToOwner.get(claudeUuid);
      if (prev !== undefined && prev !== owner) ownerToUuids.get(prev)?.delete(claudeUuid);
      if (owner === undefined) return;
      uuidToOwner.set(claudeUuid, owner);
      const set = ownerToUuids.get(owner) ?? new Set<string>();
      set.add(claudeUuid);
      ownerToUuids.set(owner, set);
    },
    cleanupByOwner: (owner) => {
      owners.cleaned.push(owner);
      const uuids = ownerToUuids.get(owner);
      if (!uuids) return;
      for (const claudeUuid of uuids) uuidToOwner.delete(claudeUuid);
      ownerToUuids.delete(owner);
    },
  };

  return { backend, sinks, ownerToUuids, owners };
}

interface Conn {
  received: Record<string, unknown>[];
  send(message: unknown): void;
  waitFor(predicate: (msg: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

async function startServer(backend: Partial<WsBackend>) {
  const { Elysia } = await import("elysia");
  const app = new Elysia()
    .use(
      createWsPlugin({} as never, testServerConfig, {
        backend: backend as WsBackend,
        eventBuffer: new EventBuffer(500),
        clientSink: { current: null },
        agentProfiles: emptyAgentProfileSource(),
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
          const timer = setTimeout(() => reject(new Error("timed out")), 2000);
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

/** The close handler runs after the socket reports closed; give it a turn. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

let stopServer: (() => void) | null = null;

afterEach(() => {
  stopServer?.();
  stopServer = null;
});

describe("socket owner cleanup", () => {
  test("a closed connection leaves no owner entry behind", async () => {
    const { backend, ownerToUuids, owners } = ownerTrackingBackend(["u1"]);
    const server = await startServer(backend);
    stopServer = server.stop;

    const conn = await server.connect();
    conn.send({ type: "list_terminal_sessions" });
    await conn.waitFor((msg) => msg.type === "terminal_sessions");
    expect(ownerToUuids.size).toBe(1);

    await conn.close();
    await settle();

    // The receipt: close hands back the SAME identity the message-time
    // registration used. Elysia's per-callback wrapper never satisfies this.
    expect(owners.cleaned[0]).toBe(owners.registered[0]);
    expect(ownerToUuids.size).toBe(0);
  });

  test("ten reconnect cycles do not accumulate owners", async () => {
    const { backend, ownerToUuids } = ownerTrackingBackend(["u1"]);
    const server = await startServer(backend);
    stopServer = server.stop;

    for (let i = 0; i < 10; i += 1) {
      const conn = await server.connect();
      conn.send({ type: "list_terminal_sessions" });
      await conn.waitFor((msg) => msg.type === "terminal_sessions");
      await conn.close();
      await settle();
    }

    // Pre-fix this was 10 — one dead ElysiaWS (and its socket) per cycle.
    expect(ownerToUuids.size).toBe(0);
  });

  test("an event landing during the outage still replays on reconnect", async () => {
    // The scope line: reaping the owner index must not cost the connection its
    // sink. permission_request rides that same sink, and a dropped prompt is a
    // 90s auto-deny the user never saw.
    const { backend, sinks } = ownerTrackingBackend(["u1"]);
    const server = await startServer(backend);
    stopServer = server.stop;

    const first = await server.connect();
    first.send({ type: "list_terminal_sessions" });
    await first.waitFor((msg) => msg.type === "terminal_sessions");
    await first.close();
    await settle();

    sinks.get("u1")?.({ type: "permission_request", sessionId: "u1", requestId: "r1" });

    const second = await server.connect();
    second.send({ type: "reconnect", lastEventId: null, sessionIds: ["u1"] });

    const event = await second.waitFor((msg) => msg.type === "event");
    expect(event.payload).toMatchObject({ type: "permission_request", requestId: "r1" });

    await second.close();
  });

  test("closing one connection does not unbind another that is still open", async () => {
    const { backend, sinks, ownerToUuids } = ownerTrackingBackend(["u1"]);
    const server = await startServer(backend);
    stopServer = server.stop;

    const first = await server.connect();
    first.send({ type: "list_terminal_sessions" });
    await first.waitFor((msg) => msg.type === "terminal_sessions");

    // The rebind: the newest registration owns u1, last write wins.
    const second = await server.connect();
    second.send({ type: "list_terminal_sessions" });
    await second.waitFor((msg) => msg.type === "terminal_sessions");

    await first.close();
    await settle();

    expect(ownerToUuids.size).toBe(1);
    sinks.get("u1")?.({ type: "session_state", sessionId: "u1", state: "running" });
    const event = await second.waitFor((msg) => msg.type === "event");
    expect(event.sessionId).toBe("u1");

    await second.close();
  });
});
