/**
 * ws-harness.ts — drives the real WS plugin over a real socket.
 *
 * The message handler lives inside an Elysia `.ws()` route, so the only way to
 * exercise it as production does — Zod gate, dispatch, event envelopes, buffer
 * writes — is to bind an ephemeral port and speak to it. Everything the plugin
 * collaborates with is injected, so no daemon, session manager or claude is
 * involved; the port is local and released at the end of each test.
 */

import type { ServerConfig } from "../config";
import { EventBuffer } from "../event-buffer";
import type { createPtyPermissionRelay } from "../pty-permission-relay";
import { createWsPlugin, type WsBackend } from "../ws";

export const testServerConfig: ServerConfig = {
  port: 0,
  hostname: "127.0.0.1",
  defaultCwd: null,
  permissionMode: "default",
  allowedRoots: null,
  basePath: "",
};

const sessionManagerStub = { updateCanUseTool: () => {} } as never;

const permissionBridgeFactoryStub = (() => ({
  canUseTool: async () => ({ behavior: "allow" }),
  updateSendToClient: () => {},
  resumePending: () => {},
  pausePending: () => [],
  // The SDK bridge half of the permission broadcast; a stub missing it makes
  // the handler throw before any relay is reached.
  resolvePermission: () => {},
})) as never;

const relayStub = {
  requestPtyPermission: () => new Promise(() => {}),
  resolvePermission: () => {},
  getPendingCount: () => 0,
  hasPendingForSession: () => false,
  pausePending: () => [],
  resumePending: () => {},
} as never;

export interface WsHarness {
  /** Messages the server sent, in order, already JSON-parsed. */
  received: Record<string, unknown>[];
  eventBuffer: EventBuffer;
  send(message: unknown): void;
  /** Resolves with the first received message matching `predicate`. */
  waitFor(
    predicate: (msg: Record<string, unknown>) => boolean,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/** Relay overrides for tests that need an observable relay instead of the stub. */
export interface WsHarnessOverrides {
  ptyRelay?: ReturnType<typeof createPtyPermissionRelay>;
  tmuxPermissionRelay?: ReturnType<typeof createPtyPermissionRelay>;
}

export async function startWsHarness(
  backend: Partial<WsBackend>,
  serverConfig: ServerConfig = testServerConfig,
  overrides: WsHarnessOverrides = {},
): Promise<WsHarness> {
  const { Elysia } = await import("elysia");
  const eventBuffer = new EventBuffer(500);

  const app = new Elysia()
    .use(
      createWsPlugin(sessionManagerStub, permissionBridgeFactoryStub, serverConfig, {
        backend: backend as WsBackend,
        ptyOrchestrator: {} as never,
        ptyRelay: (overrides.ptyRelay as never) ?? relayStub,
        tmuxPermissionRelay: (overrides.tmuxPermissionRelay as never) ?? relayStub,
        ptyResponseRelay: {} as never,
        eventBuffer,
        clientSink: { current: null },
      }),
    )
    .listen(0);

  const port = (app.server as { port: number }).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}${serverConfig.basePath}/ws`);
  const received: Record<string, unknown>[] = [];
  const listeners: ((msg: Record<string, unknown>) => void)[] = [];

  socket.onmessage = (event) => {
    const parsed = JSON.parse(String(event.data)) as Record<string, unknown>;
    received.push(parsed);
    for (const listener of [...listeners]) listener(parsed);
  };

  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("ws harness failed to connect"));
  });

  return {
    received,
    eventBuffer,
    send: (message) => socket.send(JSON.stringify(message)),
    waitFor(predicate, timeoutMs = 2000) {
      const already = received.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `timed out waiting; received: ${JSON.stringify(received.map((m) => m.type))}`,
            ),
          );
        }, timeoutMs);
        listeners.push((msg) => {
          if (!predicate(msg)) return;
          clearTimeout(timer);
          resolve(msg);
        });
      });
    },
    close() {
      socket.close();
      // Force-close: awaiting a graceful stop hangs until the just-closed
      // socket finishes draining, which outlives the test.
      (app.server as { stop(force?: boolean): void } | null)?.stop(true);
      return Promise.resolve();
    },
  };
}
