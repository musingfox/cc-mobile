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
import { type AgentState, statesFromSnapshot } from "./agent-state";
import { createHerdrClient, type HerdrClient, SUPPORTED_PROTOCOL } from "./client";
import { createHerdrRegistry } from "./registry";
import { createHerdrSendRouting } from "./send-routing";
import { listClaudeSessions, type SessionDescriptor, type SessionListingClient } from "./sessions";
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
  > &
    // Optional because both degrade rather than fail: a client slice without
    // `sessionSnapshot` costs the UI its status dot, and one without
    // `agentList` answers an empty session list — never a thrown reply.
    Partial<Pick<HerdrClient, "sessionSnapshot" | "agentList">>;
  /** Injectable label suppression for the live-e2e suites (Decision M9). */
  suppressSessionLabel?: (label: string) => boolean;
  readinessBudgetMs?: number;
  readinessPollMs?: number;
}

/**
 * The port plus the capabilities only herdr has: the daemon knows every claude
 * on the machine, including ones cc-mobile never launched, so this backend can
 * answer "what is running" from a live query instead of from its own memory.
 * Not every backend can, so this stays off the neutral port.
 */
export interface HerdrTerminalBackend extends TerminalBackend {
  /**
   * Every claude the daemon reports, with identity and capability flags.
   * Never rejects: an unreachable daemon answers `[]`.
   */
  listSessionDescriptors(): Promise<SessionDescriptor[]>;
  /**
   * What every live session is doing right now, from one daemon call. The
   * status subscription only fires on change, so this is the only way a client
   * that reloaded mid-session can learn the current state without waiting for
   * the next transition. Never rejects: a daemon hiccup costs the dot, not the
   * reply.
   */
  listStates(): Promise<Record<string, AgentState>>;
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

  async function teardown(claudeUuid: string) {
    statusEvents.stop(claudeUuid);
    // Kill first, then cancel the waiter.
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
     * Derived on demand from the daemon rather than from this process's memory,
     * which is what makes a pane the user opened in their own terminal — and a
     * pane that outlived a server restart — appear without any rediscovery step
     * (Decision M12).
     */
    async listSessionDescriptors(): Promise<SessionDescriptor[]> {
      if (typeof client.agentList !== "function") return [];
      return listClaudeSessions({
        client: client as SessionListingClient,
        suppressLabel: options.suppressSessionLabel,
      });
    },
    /**
     * One RPC regardless of session count — the join happens locally against
     * the uuid→pane registry, so N live sessions still cost one round trip.
     */
    async listStates(): Promise<Record<string, AgentState>> {
      try {
        if (typeof client.sessionSnapshot !== "function") return {};
        const snapshot = await client.sessionSnapshot();
        return statesFromSnapshot(snapshot, registry.resolvePane, registry.listSessions());
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`[herdr] agent state snapshot failed: ${detail}`);
        return {};
      }
    },
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
