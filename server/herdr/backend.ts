/**
 * backend.ts — the herdr TerminalBackend adapter + the startup compatibility gate.
 *
 * Composes the three herdr modules into the TerminalBackend port the transport
 * layer speaks: registry (lifecycle), send-routing (prompt in, reply out),
 * status-events (activity indicator).
 *
 * herdr is the sole default backend with no runtime fallback (plan D1): a missing
 * or incompatible daemon is a deploy-time failure via verifyHerdrStartup, not a
 * surprise on the user's first tap.
 */

import type { createPtyResponseRelay } from "../pty-response-relay";
import type { ClientSink, TerminalBackend, TerminalSessionInfo } from "../terminal-backend";
import { createHerdrClient, type HerdrClient, SUPPORTED_PROTOCOL } from "./client";
import { createHerdrRegistry } from "./registry";
import { type RemountReport, remountLiveSessions } from "./remount";
import { createHerdrSendRouting } from "./send-routing";
import { createHerdrStatusEvents } from "./status-events";
import { resolveSocketPath } from "./transport";

export interface HerdrBackendOptions {
  /** Shared with the HTTP Stop-hook endpoint — same instance, or replies never land. */
  responseRelay: ReturnType<typeof createPtyResponseRelay>;
  responseUrl?: string;
  permissionUrl?: string;
  /** claude --permission-mode for launched sessions (default "default"). */
  permissionMode?: string;
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

/**
 * The port plus the one capability only herdr has: because the daemon keeps
 * panes alive across a server restart, this backend can rediscover its own
 * sessions at startup. tmux never could, so this stays off the neutral port.
 */
export interface HerdrTerminalBackend extends TerminalBackend {
  remountLiveSessions(): Promise<RemountReport>;
  /**
   * claudeUuids the last remount skipped rather than adopted or reaped —
   * possibly alive but not routable. Carried into the terminal_sessions reply
   * so a reconciling client leaves their cards alone instead of deleting them.
   */
  listUnknown(): string[];
}

export function createHerdrBackend(options: HerdrBackendOptions): HerdrTerminalBackend {
  const client = options.client ?? createHerdrClient();

  const registry = createHerdrRegistry({
    client,
    responseUrl: options.responseUrl,
    permissionUrl: options.permissionUrl,
    permissionMode: options.permissionMode,
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

  // Filled by remountLiveSessions; a uuid both adopted and skipped (duplicate
  // workspaces) counts as adopted, so the two lists start disjoint.
  let unknownUuids: string[] = [];

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
    /**
     * Mirrors createSession's composition order — register, then subscribe —
     * so an adopted session is indistinguishable from one this process built.
     */
    remountLiveSessions: async () => {
      const report = await remountLiveSessions({
        client,
        adopt: (entry) => registry.adoptSession(entry),
        subscribeStatus: (claudeUuid, paneId) => statusEvents.start(claudeUuid, paneId),
      });
      const adopted = new Set(report.adopted);
      unknownUuids = [...new Set(report.skipped.map((entry) => entry.uuid))].filter(
        (uuid) => !adopted.has(uuid),
      );
      return report;
    },
    // Filtered at query time: a uuid that has become routable since the scan
    // must answer as live, never as unknown.
    listUnknown: () => unknownUuids.filter((uuid) => !registry.hasSession(uuid).present),
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
