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

import { resolveAgentTranscriptPath } from "../agents/transcript-readers";
import type { ClientSink, TerminalBackend, TerminalSessionInfo } from "../terminal-backend";
import { createTranscriptDelivery } from "../transcript/delivery";
import { type AgentState, statesFromSnapshot } from "./agent-state";
import { createHerdrClient, type HerdrClient, SUPPORTED_PROTOCOL } from "./client";
import { createHerdrPaneEvents } from "./pane-events";
import { createNativePermission } from "./permission/native-permission";
import { createHerdrRegistry } from "./registry";
import { createHerdrSendRouting } from "./send-routing";
import { listClaudeSessions, type SessionDescriptor, type SessionListingClient } from "./sessions";
import { resolveSocketPath } from "./transport";

export interface HerdrBackendOptions {
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

/**
 * Whether a pane's status report should reach the permission flow.
 *
 * That flow is claude's end to end: the screen parser reads claude's prompt box
 * and the answer is a keystroke aimed at claude's option list. So a pane known
 * to be running something else is held back until each agent has its own parser
 * (#33). Everything that is not `blocked` is forwarded whatever the kind — that
 * is how a pending prompt gets dropped and its 90 s `esc` timer cleared.
 *
 * A deny-list (block the kinds known not to be claude) rather than an allow-list
 * (forward only "claude"), for four reasons:
 *
 *  1. An unreported kind is most often a claude whose detection has not landed
 *     yet — herdr fills `agent` from its own probe, which can trail the first
 *     status report.
 *  2. An allow-list's mistake is unrecoverable: swallow one `blocked` and
 *     pane-events' `status === previous` early return (pane-events.ts) means the
 *     same status is never re-announced, so nothing retries for the rest of that
 *     turn. `resumePermissions()` cannot save it either — the prompt was never
 *     pending. A deny-list's mistake is merely a prompt shown for a pane whose
 *     kind arrives late.
 *  3. The cost of the deny-list being wrong is bounded: a non-claude screen that
 *     the parser cannot read degrades to a Cancel-only sheet, which sends `esc`
 *     at worst.
 *  4. The one keystroke cc-mobile sends by itself — the 90 s unattended `esc` —
 *     only fires on panes cc-mobile launched, and those are always claude.
 */
export function permissionAppliesTo(status: string, kind: string | undefined): boolean {
  if (status !== "blocked") return true;
  // Only a kind we positively recognise as non-claude suppresses. Absent or
  // empty both mean "herdr hasn't said yet", so both forward — the predicate is
  // exported, and must not lean on its caller having filtered empties out.
  if (!kind) return true;
  return kind === "claude";
}

export function createHerdrBackend(options: HerdrBackendOptions): HerdrTerminalBackend {
  const client = options.client ?? createHerdrClient();

  const registry = createHerdrRegistry({
    client,
    permissionMode: options.permissionMode,
    readinessBudgetMs: options.readinessBudgetMs,
    readinessPollMs: options.readinessPollMs,
  });

  const routing = createHerdrSendRouting({
    client,
    resolvePane: registry.resolvePane,
    // Pane-keyed fallback: a session the user opened in their own terminal has
    // no registry entry, and the daemon's listing is the only thing that knows
    // it exists (Decision H1).
    listDrivablePanes: async () =>
      (await listSessionDescriptors())
        .filter((session) => session.drivable)
        .map((session) => session.sessionId),
  });

  async function listSessionDescriptors(): Promise<SessionDescriptor[]> {
    if (typeof client.agentList !== "function") return [];
    return listClaudeSessions({
      client: client as SessionListingClient,
      suppressLabel: options.suppressSessionLabel,
    });
  }

  const delivery = createTranscriptDelivery({
    resolvePath: async (sessionId) => {
      const match = (await listSessionDescriptors()).find(
        (session) => session.sessionId === sessionId,
      );
      if (!match) return null;
      // Routed by kind: the listing now carries panes running something other
      // than claude, and only a kind with a registered reader is looked for.
      return resolveAgentTranscriptPath({
        agent: match.agent,
        sessionValue: match.agentSessionValue,
        cwd: match.cwd,
      });
    },
    // Late-bound: a reconnect rebinds the session to a fresh sink.
    getSink: (sessionId) => routing.getClient(sessionId),
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

  // Bound once: the poll below runs for the life of the process, and a client
  // slice without this method simply has no level-triggered status source.
  const sessionSnapshot = client.sessionSnapshot;
  const paneEvents = createHerdrPaneEvents({
    subscribe: (subscribeOptions) => client.subscribeEvents(subscribeOptions),
    getSink: (sessionId) => routing.getClient(sessionId),
    // What the poll backs off on. A sink outlives its connection (it buffers for
    // the reconnect), so the sink map cannot answer this — ownership can.
    hasClients: () => routing.hasClients(),
    // The status source. Without it a turn that settles without changing the
    // pane's title is never read back at all — see pane-events.ts's header.
    ...(typeof sessionSnapshot === "function"
      ? { snapshot: () => sessionSnapshot.call(client) }
      : {}),
    permission: {
      onStatus: (sessionId, status, kind) => {
        if (!permissionAppliesTo(status, kind)) return;
        return permission.onStatus(sessionId, status);
      },
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
      return { name: info.agentName, paneRef: info.paneId };
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
     * One RPC regardless of session count — the join happens locally, so N live
     * sessions still cost one round trip.
     *
     * Keyed by pane id, like everything else the client sees (Decision H5).
     * Every pane in the snapshot is included rather than only the ones this
     * process launched: the client looks up the ids it holds, and narrowing the
     * map to the registry is what used to make it answer nothing at all for a
     * session the user started in their own terminal.
     */
    async listStates(): Promise<Record<string, AgentState>> {
      try {
        if (typeof client.sessionSnapshot !== "function") return {};
        const snapshot = await client.sessionSnapshot();
        const paneIds = (snapshot.panes ?? []).map((pane) => pane.pane_id);
        return statesFromSnapshot(snapshot, (paneId) => paneId, paneIds);
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
