/**
 * send-routing.ts — HerdrPromptInjection + the client sink map.
 *
 * `pane.send_text` lands multi-line text in the composer without submitting,
 * then `pane.send_keys ["Enter"]` submits the whole thing as one turn
 * (live-verified 2026-08-01). No prompt flattening.
 *
 * This module no longer waits for a reply. Since #29 the answer comes from
 * claude's own transcript file (`server/transcript/`), driven by the status
 * transition herdr reports — so a session the user started in their own
 * terminal reads back exactly like one cc-mobile launched, which a Stop hook
 * cc-mobile installs never could. What survives is the sink map, including its
 * late-bound lookup: a reconnect rebinds a session to a fresh sink and the
 * delivery module consults it at delivery time (E1/E3).
 *
 * `agent.wait` is deliberately never called: it matches the CURRENT settled
 * state, so waiting after a second Enter resolves instantly on the previous
 * turn's `done`.
 */

import { composerHasTypedText } from "./prompt-box";

export type ClientSink = (msg: Record<string, unknown>) => void;

/** The pane-injection slice of the herdr client. */
export interface HerdrSendClient {
  paneSendText(paneId: string, text: string): Promise<void>;
  paneSendKeys(paneId: string, keys: string[]): Promise<void>;
  /** Readiness probe: what is this pane's claude doing right now? */
  agentGet(target: string): Promise<{ agent_status?: string }>;
  /** Readiness probe: what is on its screen right now? */
  paneRead(params: { pane_id: string; source: "detection" }): Promise<{ text: string }>;
}

export interface HerdrSendRoutingOptions {
  client: HerdrSendClient;
  /** claudeUuid → herdr pane id; the registry owns the mapping. */
  resolvePane: (claudeUuid: string) => string | undefined;
  /**
   * Pane ids the daemon reports as drivable. The fallback for a session key
   * that IS a pane id — every session the user opened in their own terminal,
   * which this process's registry has never heard of (Decision H1/H5).
   */
  listDrivablePanes?: () => Promise<string[]>;
}

/** Statuses in which claude is waiting for input rather than doing something. */
const READY_STATUSES = new Set(["idle", "done"]);

export interface HerdrSendParams {
  claudeUuid: string;
  content: string;
}

export function createHerdrSendRouting(options: HerdrSendRoutingOptions) {
  const { client, resolvePane } = options;
  const listDrivablePanes = options.listDrivablePanes ?? (async () => []);

  const clientSinks = new Map<string, ClientSink>();
  const ownerToUuids = new Map<unknown, Set<string>>();
  const uuidToOwner = new Map<string, unknown>();
  /** Sinks bound with no connection behind them; see `hasClients`. */
  const ownerlessSinks = new Set<string>();

  function registerClient(claudeUuid: string, sink: ClientSink, owner?: unknown) {
    if (owner === undefined) ownerlessSinks.add(claudeUuid);
    else ownerlessSinks.delete(claudeUuid);
    clientSinks.set(claudeUuid, sink);
    const prevOwner = uuidToOwner.get(claudeUuid);
    if (prevOwner !== undefined && prevOwner !== owner) {
      ownerToUuids.get(prevOwner)?.delete(claudeUuid);
    }
    if (owner !== undefined) {
      uuidToOwner.set(claudeUuid, owner);
      let set = ownerToUuids.get(owner);
      if (!set) {
        set = new Set();
        ownerToUuids.set(owner, set);
      }
      set.add(claudeUuid);
    } else {
      uuidToOwner.delete(claudeUuid);
    }
  }

  /**
   * The pane this session key addresses.
   *
   * A key this process launched resolves through the registry. Any other key is
   * treated as a pane id and checked against the daemon's own drivable list,
   * which is what lets the phone continue a session the user started in their
   * own terminal — the registry has no entry for one and never will.
   */
  async function resolveTarget(sessionKey: string): Promise<string | undefined> {
    const own = resolvePane(sessionKey);
    if (own !== undefined) return own;
    try {
      return (await listDrivablePanes()).includes(sessionKey) ? sessionKey : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Whether a prompt may be typed into this pane right now.
   *
   * Two refusals only: claude is mid-turn, or a human has half-typed something
   * in the composer. The pane's permission mode is deliberately NOT consulted —
   * an ungated pane is driven exactly like any other, flagged rather than
   * blocked, by the owner's own ruling (Decision H4).
   *
   * A probe that cannot be completed does not refuse: a daemon hiccup must not
   * silently swallow the user's prompt, and the injection itself reports its own
   * failure.
   */
  async function isReady(paneId: string): Promise<boolean> {
    try {
      const status = (await client.agentGet(paneId)).agent_status;
      if (typeof status === "string" && !READY_STATUSES.has(status)) return false;
    } catch {
      return true;
    }
    try {
      const read = await client.paneRead({ pane_id: paneId, source: "detection" });
      return !composerHasTypedText(read.text);
    } catch {
      return true;
    }
  }

  async function send(params: HerdrSendParams): Promise<void> {
    const { claudeUuid, content } = params;
    if (!clientSinks.has(claudeUuid)) {
      // Unregistered: no RPC, no waiter (the port's send never throws).
      return;
    }

    const paneId = await resolveTarget(claudeUuid);

    // Readiness is decided BEFORE the waiter is armed: a refusal must leave no
    // trace at all — no injection, no pending turn, nothing for the UI to spin
    // on.
    if (paneId !== undefined && !(await isReady(paneId))) {
      clientSinks.get(claudeUuid)?.({
        type: "error",
        sessionId: claudeUuid,
        code: "session_busy",
        message:
          "That session is busy — it is mid-turn or someone has started typing in the terminal. Nothing was sent.",
      });
      return;
    }

    try {
      if (paneId === undefined) {
        throw new Error("no pane mapping");
      }
      // Verbatim: newlines land in the composer, Enter submits one turn.
      await client.paneSendText(paneId, content);
      await client.paneSendKeys(paneId, ["Enter"]);
    } catch (error) {
      // The pane is gone or unreachable: say so rather than leaving the phone
      // waiting for a turn that was never started.
      const failSink = clientSinks.get(claudeUuid);
      failSink?.({
        type: "error",
        sessionId: claudeUuid,
        code: "terminal_send_failed",
        message: `Terminal session ${claudeUuid} is not reachable (${
          error instanceof Error ? error.message : String(error)
        }). The paired terminal session may have closed.`,
      });
    }
  }

  /** Terminal removal: drop the sink and the owner index for this session. */
  function teardown(claudeUuid: string): void {
    clientSinks.delete(claudeUuid);
    ownerlessSinks.delete(claudeUuid);
    const owner = uuidToOwner.get(claudeUuid);
    if (owner !== undefined) {
      ownerToUuids.get(owner)?.delete(claudeUuid);
      uuidToOwner.delete(claudeUuid);
    }
  }

  /**
   * Transient disconnect (ws close): release the owner index for that
   * connection. The sink stays installed, so a reply or a permission_request
   * landing during the gap still reaches the buffer-first sink and replays on
   * reconnect (E2). Only the owner index is per-connection
   * and therefore unbounded — `clientSinks` is uuid-keyed and last-write-wins,
   * so a reconnect displaces the stale entry and teardown removes it for good.
   */
  function cleanupByOwner(owner: unknown): void {
    const uuids = ownerToUuids.get(owner);
    if (!uuids) return;
    for (const claudeUuid of uuids) {
      uuidToOwner.delete(claudeUuid);
    }
    ownerToUuids.delete(owner);
  }

  function getClient(claudeUuid: string): ClientSink | undefined {
    return clientSinks.get(claudeUuid);
  }

  /**
   * Whether any live connection is still listening.
   *
   * Ownership, not the sink map, is the signal: a sink outlives its connection
   * on purpose (it buffers for the reconnect), while `cleanupByOwner` runs the
   * moment a socket closes. A registration made with no owner — only tests do
   * that — counts as a listener, so injecting one never silences anything.
   */
  function hasClients(): boolean {
    return ownerToUuids.size > 0 || ownerlessSinks.size > 0;
  }

  return {
    registerClient,
    hasClients,
    send,
    teardown,
    cleanupByOwner,
    getClient,
  };
}

export type HerdrSendRouting = ReturnType<typeof createHerdrSendRouting>;
