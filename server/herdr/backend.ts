/**
 * backend.ts — the herdr TerminalBackend adapter + the startup compatibility gate.
 *
 * Composes the three herdr modules into the port ws.ts and tmux-control already
 * speak: registry (lifecycle), send-routing (prompt in, reply out), status-events
 * (activity indicator). Same shape as createTmuxBackend, so swapping the default
 * at the composition root is the only wiring change.
 *
 * herdr is the sole default backend with no runtime fallback (plan D1): a missing
 * or incompatible daemon is a deploy-time failure via verifyHerdrStartup, not a
 * surprise on the user's first tap.
 */

import type { createPtyResponseRelay } from "../pty-response-relay";
import type { ClientSink, TerminalBackend, TerminalSessionInfo } from "../terminal-backend";
import { createHerdrClient, type HerdrClient, SUPPORTED_PROTOCOL } from "./client";
import { createHerdrRegistry } from "./registry";
import { createHerdrSendRouting } from "./send-routing";
import { createHerdrStatusEvents } from "./status-events";
import { resolveSocketPath } from "./transport";

export interface HerdrBackendOptions {
  /** Shared with the HTTP Stop-hook endpoint — same instance, or replies never land. */
  responseRelay: ReturnType<typeof createPtyResponseRelay>;
  responseUrl?: string;
  permissionUrl?: string;
  /**
   * Injectable client. Defaults to a real one whose transport connects lazily,
   * so constructing a backend never contacts the daemon.
   */
  client?: Pick<
    HerdrClient,
    "call" | "agentGet" | "paneSendText" | "paneSendKeys" | "subscribeEvents"
  >;
  readinessBudgetMs?: number;
  readinessPollMs?: number;
}

export function createHerdrBackend(options: HerdrBackendOptions): TerminalBackend {
  const client = options.client ?? createHerdrClient();

  const registry = createHerdrRegistry({
    client,
    responseUrl: options.responseUrl,
    permissionUrl: options.permissionUrl,
    readinessBudgetMs: options.readinessBudgetMs,
    readinessPollMs: options.readinessPollMs,
  });

  const routing = createHerdrSendRouting({
    client,
    resolvePane: registry.resolvePane,
    responseRelay: options.responseRelay,
  });

  const statusEvents = createHerdrStatusEvents({
    subscribe: (subscribeOptions) => client.subscribeEvents(subscribeOptions),
    // Late-bound: a reconnect rebinds the uuid to a fresh sink.
    getSink: (claudeUuid) => routing.getClient(claudeUuid),
  });

  async function teardown(claudeUuid: string) {
    statusEvents.stop(claudeUuid);
    // Kill first, then cancel the waiter — the order the tmux backend used.
    const result = await registry.teardown(claudeUuid);
    routing.teardown(claudeUuid);
    return result;
  }

  return {
    async createSession(input): Promise<TerminalSessionInfo> {
      const info = await registry.createSession(input);
      // Non-fatal by construction: start() never rejects.
      await statusEvents.start(input.claudeUuid, info.paneId);
      return {
        name: info.agentName,
        paneRef: info.paneId,
        settingsPath: info.settingsPath,
      };
    },
    hasSession: (claudeUuid) => registry.hasSession(claudeUuid),
    listLive: () => registry.listSessions(),
    teardown,
    async teardownAll() {
      // Routed through the composed teardown so subscriptions and waiters are
      // released too, not just the workspaces.
      for (const claudeUuid of registry.listSessions()) {
        await teardown(claudeUuid);
      }
    },
    send: (params) => routing.send(params),
    registerClient: (claudeUuid: string, sink: ClientSink, owner?: unknown) =>
      routing.registerClient(claudeUuid, sink, owner),
    getClient: (claudeUuid) => routing.getClient(claudeUuid),
    cleanupByOwner: (owner) => routing.cleanupByOwner(owner),
  };
}

/**
 * Fails loudly when no protocol-compatible herdr daemon is reachable. Called
 * before `listen` so a misconfigured daemon is a deploy-time error rather than
 * a broken first tap — herdr has no runtime fallback (plan D1).
 */
export async function verifyHerdrStartup(
  client?: Pick<HerdrClient, "assertCompatible">,
  socketPath?: string,
): Promise<void> {
  const resolvedSocketPath = resolveSocketPath(socketPath);
  const target = client ?? createHerdrClient({ socketPath: resolvedSocketPath });

  try {
    await target.assertCompatible();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `herdr daemon unusable at ${resolvedSocketPath}: ${detail}. ` +
        `cc-mobile drives terminal sessions through herdr (protocol ${SUPPORTED_PROTOCOL}); ` +
        `start the daemon or set HERDR_SOCKET_PATH.`,
    );
  }
}
