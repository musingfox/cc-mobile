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
import { createTranscriptDelivery } from "../transcript/delivery";
import { resolveTranscriptPath } from "../transcript/path";
import { type AgentState, statesFromSnapshot } from "./agent-state";
import { createHerdrClient, type HerdrClient, SUPPORTED_PROTOCOL } from "./client";
import { createHerdrPaneEvents } from "./pane-events";
import { createNativePermission } from "./permission/native-permission";
import { createHerdrRegistry } from "./registry";
import { createHerdrSendRouting } from "./send-routing";
import { listClaudeSessions, type SessionDescriptor, type SessionListingClient } from "./sessions";
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
    "call" | "agentGet" | "paneRead" | "paneSendText" | "paneSendKeys" | "subscribeEvents"
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
  /**
   * Presses the chosen option's key in the pane, after re-proving on live RPCs
   * that the same prompt is still on screen. Resolves `false` — silently, with
   * no keystroke — for a `requestId` this backend never issued.
   */
  resolvePermission(
    requestId: string,
    answer: { optionId?: string; allow?: boolean },
  ): Promise<boolean>;
  /** Connection lost: stop treating pending prompts as seen by the phone. */
  pausePermissions(): void;
  /** Reconnect: re-read and re-emit every prompt still on screen. */
  resumePermissions(): Promise<void>;
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

  async function listSessionDescriptors(): Promise<SessionDescriptor[]> {
    if (typeof client.agentList !== "function") return [];
    return listClaudeSessions({
      client: client as SessionListingClient,
      suppressLabel: options.suppressSessionLabel,
    });
  }

  /**
   * True while this process still has the hook chain armed for a session: its
   * Stop hook resolves a waiter that emits the reply itself, so reading the same
   * turn out of the transcript would deliver it twice (Decision M7). Sessions
   * launched by an earlier process — and every foreign pane — have no live
   * waiter, so they read back from the transcript today.
   */
  function legacyReadback(sessionId: string): boolean {
    if (registry.hasSession(sessionId).present) return true;
    return registry
      .listSessions()
      .some((claudeUuid) => registry.resolvePane(claudeUuid) === sessionId);
  }

  const delivery = createTranscriptDelivery({
    resolvePath: async (sessionId) => {
      const match = (await listSessionDescriptors()).find(
        (session) => session.sessionId === sessionId,
      );
      if (!match) return null;
      return resolveTranscriptPath({ sessionValue: match.agentSessionValue, cwd: match.cwd });
    },
    // Late-bound: a reconnect rebinds the session to a fresh sink.
    getSink: (sessionId) => routing.getClient(sessionId),
    legacyReadback,
  });

  /**
   * Permissions with no hook behind them: herdr says `blocked`, the screen is
   * read and parsed, the phone answers with a keystroke. This works for panes
   * cc-mobile never launched, which a PreToolUse hook it installs never could.
   */
  const permission = createNativePermission({
    client: {
      agentGet: (target) => client.agentGet(target),
      paneRead: (params) => client.paneRead(params),
      paneSendKeys: (paneId, keys) => client.paneSendKeys(paneId, keys),
    },
    getSink: (sessionId) => routing.getClient(sessionId),
    // Recorded at emit time because it gates the automated deny (Decision H2),
    // which must not depend on a listing succeeding 90 s later.
    originOf: async (sessionId) => {
      const match = (await listSessionDescriptors()).find(
        (session) => session.sessionId === sessionId,
      );
      return match?.origin ?? "foreign";
    },
  });

  const paneEvents = createHerdrPaneEvents({
    subscribe: (subscribeOptions) => client.subscribeEvents(subscribeOptions),
    getSink: (sessionId) => routing.getClient(sessionId),
    permission: {
      onStatus: (sessionId, status) => permission.onStatus(sessionId, status),
    },
    transcript: {
      attach: (sessionId) => delivery.attach(sessionId),
      resetCursor: (sessionId) => delivery.resetCursor(sessionId),
      onStatus: (sessionId, status) => delivery.onStatus(sessionId, status),
      deliverTurn: (sessionId) => delivery.deliverTurn(sessionId),
    },
  });

  /**
   * Opens the global event stream on first use rather than at construction, so
   * building the backend still contacts no daemon (app.ts assembles it before
   * anything has checked the socket).
   */
  function ensureEvents(): Promise<void> {
    return paneEvents.start();
  }

  /**
   * Closes a session — but only one cc-mobile started.
   *
   * Under the global listing the phone can see the user's own terminal
   * sessions, and the same close control sits on every card. `workspace.close`
   * on a foreign pane would kill a terminal the user is working in, so a pane
   * whose workspace carries no `ccm-<uuid>` label is refused outright, with no
   * RPC issued at all (Decision M13). Ownership is read from the label, not from
   * this process's registry, so it survives a server restart.
   */
  async function teardown(sessionKey: string) {
    // A session this process launched: routed by uuid, torn down as before.
    if (registry.hasSession(sessionKey).present) {
      const paneId = registry.resolvePane(sessionKey);
      // Kill first, then cancel the waiter.
      const result = await registry.teardown(sessionKey);
      routing.teardown(sessionKey);
      forgetSession(sessionKey);
      if (paneId) forgetSession(paneId);
      return result;
    }

    const match = (await listSessionDescriptors()).find(
      (session) => session.sessionId === sessionKey,
    );
    // Already gone from the daemon: idempotent, and nothing to close.
    if (!match) return { killed: false };
    if (match.origin === "foreign") return { killed: false, reason: "not_owned" as const };

    await client.call("workspace.close", { workspace_id: match.workspaceId });
    routing.teardown(sessionKey);
    forgetSession(sessionKey);
    return { killed: true };
  }

  /** Drops everything remembered about a session that no longer exists. */
  function forgetSession(sessionId: string): void {
    paneEvents.forget(sessionId);
    delivery.forget(sessionId);
    permission.forget(sessionId);
  }

  return {
    async createSession(input): Promise<TerminalSessionInfo> {
      const info = await registry.createSession(input);
      // Non-fatal by construction: start() never rejects.
      await ensureEvents();
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
      // First listing is also what opens the event stream: the phone asking
      // "what is running" is the earliest moment a daemon connection is wanted.
      await ensureEvents();
      return listSessionDescriptors();
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
    /**
     * Answers a native (screen-derived) permission prompt. Reports whether this
     * backend owned the id, so the transport can fall through to the legacy hook
     * relay for a request that came from there instead.
     */
    resolvePermission: (requestId, answer) => permission.resolve(requestId, answer),
    pausePermissions: () => permission.pause(),
    resumePermissions: () => permission.resume(),
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
