/**
 * pane-events.ts — PaneEventStatusForwarding + PaneEventIdentityChange: one
 * global event stream behind every live signal the phone gets.
 *
 * Replaces the per-session `pane.agent_status_changed` subscriptions. Those
 * required a `pane_id` up front, which is impossible for a pane cc-mobile never
 * launched — and the whole point of #29 is that such panes are first-class.
 * `pane.updated` needs only a type filter and its payload is the full PaneInfo,
 * so discovery, status **and** session-id rotation arrive on one stream
 * (Decision M5, research P8).
 *
 * Live wire fact (probe 2026-08-02): herdr's event names are inconsistent —
 * `pane.agent_status_changed` arrives dotted with the pane fields directly on
 * `data`, while `pane_updated` arrives underscored with them nested under
 * `data.pane`. The bundled schema disagrees with the wire on the first one. Both
 * shapes are read here rather than assuming either convention.
 *
 * The stream alone is NOT a status source (probe 2026-08-02, herdr
 * `src/app/api.rs:580-624`): a pure status change emits only
 * `pane.agent_status_changed`, whose subscription requires a concrete `pane_id`
 * — the one thing a global watcher does not have. `pane.updated` is emitted for
 * an agent *name* change, a terminal-title change and metadata expiry, and only
 * happens to carry the current status inside its pane record. A turn that
 * settles without touching the title therefore reports nothing at all, which is
 * a reply the phone never receives. So a `session.snapshot` poll runs alongside
 * the stream and feeds the same `observe`, which makes status level-triggered:
 * the settle is noticed within one tick whether or not any event fires. The
 * stream is kept for what the snapshot's panes do not carry — `agent_session`,
 * i.e. the `/clear` that rotates the transcript.
 *
 * What each signal drives:
 *   status change  → `session_state` to the client, plus the transcript tail
 *                    (armed while `working`) and a turn delivery when the
 *                    session settles.
 *   session change → the transcript cursor is dropped and re-taken at the new
 *                    file's end (`/clear` rotates the uuid and starts a new
 *                    file — research P6).
 */

import { STATE_BY_AGENT_STATUS } from "./agent-state";
import type { AgentInfo, PaneInfo, SessionSnapshot } from "./schema";
import type { SubscribeEventsOptions, SubscriptionHandle } from "./subscribe";

export type ClientSink = (msg: Record<string, unknown>) => void;

/** The transcript side of the wiring; every call is fire-and-forget. */
export interface PaneEventTranscript {
  /** First contact with a session: take a cursor at end of file. */
  attach(sessionId: string): Promise<void> | void;
  /** The conversation rotated: drop the cursor and re-take it. */
  resetCursor(sessionId: string): Promise<void> | void;
  /** Arms or stops the mid-turn tail. */
  onStatus(sessionId: string, status: string): Promise<void> | void;
  /** The turn settled: deliver everything written since the last read. */
  deliverTurn(sessionId: string): Promise<void> | void;
}

/** The permission side of the wiring; `blocked` is what raises a prompt. */
export interface PaneEventPermission {
  onStatus(sessionId: string, status: string): Promise<void> | void;
}

/** Handle returned by the injected interval scheduler. */
export type TimerHandle = unknown;

export const DEFAULT_STATUS_POLL_MS = 1_000;

export interface HerdrPaneEventsOptions {
  subscribe: (options: SubscribeEventsOptions) => Promise<SubscriptionHandle>;
  /** Late-bound sink lookup, so a reconnect that rebinds a session still gets events. */
  getSink: (sessionId: string) => ClientSink | undefined;
  /**
   * The level-triggered status source (see the module header). Optional: a
   * client slice without it degrades to the stream's incidental status reports,
   * which is what this module did before the poll existed.
   */
  snapshot?: () => Promise<{ panes?: Partial<PaneInfo>[]; agents?: Partial<AgentInfo>[] }>;
  pollIntervalMs?: number;
  setIntervalFn?: (fn: () => void, ms: number) => TimerHandle;
  clearIntervalFn?: (handle: TimerHandle) => void;
  transcript?: PaneEventTranscript;
  permission?: PaneEventPermission;
  onError?: (error: Error) => void;
}

/** Statuses that mean "this turn is over" and therefore "read the transcript". */
const SETTLED_STATUSES = new Set(["idle", "done"]);

interface PaneState {
  status?: string;
  sessionValue?: string | null;
  /** Last `state_change_seq` seen for this pane; see `observe`. */
  seq?: number;
}

/** Pane fields, wherever this event kind happens to put them. */
function paneFieldsOf(event: { data?: unknown }): Partial<PaneInfo> | undefined {
  const data = event.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== "object") return undefined;
  const nested = data.pane;
  const source = (nested && typeof nested === "object" ? nested : data) as Partial<PaneInfo>;
  return typeof source.pane_id === "string" ? source : undefined;
}

/**
 * Panes carrying their agent's `state_change_seq`.
 *
 * The snapshot splits what one pane is doing across two arrays: `panes` has the
 * status, `agents` has the transition counter, joined on `pane_id`. Merging
 * here keeps `observe` a single-record function, so an event (which has no
 * counter) and a snapshot row take exactly the same path.
 */
function panesWithSeq(snapshot: {
  panes?: Partial<PaneInfo>[];
  agents?: Partial<AgentInfo>[];
}): Partial<PaneInfo>[] {
  const seqByPane = new Map<string, number>();
  for (const agent of snapshot.agents ?? []) {
    if (typeof agent.pane_id === "string" && typeof agent.state_change_seq === "number") {
      seqByPane.set(agent.pane_id, agent.state_change_seq);
    }
  }
  if (seqByPane.size === 0) return snapshot.panes ?? [];
  return (snapshot.panes ?? []).map((pane) => {
    const seq = pane.pane_id ? seqByPane.get(pane.pane_id) : undefined;
    return seq === undefined ? pane : { ...pane, state_change_seq: seq };
  });
}

export function createHerdrPaneEvents(options: HerdrPaneEventsOptions) {
  const { subscribe, getSink, snapshot, transcript, permission } = options;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_STATUS_POLL_MS;
  const setIntervalFn =
    options.setIntervalFn ??
    ((fn: () => void, ms: number) => {
      const timer = setInterval(fn, ms);
      // A background poll must never be the reason a process stays alive.
      (timer as { unref?: () => void }).unref?.();
      return timer;
    });
  const clearIntervalFn =
    options.clearIntervalFn ??
    ((handle: TimerHandle) => clearInterval(handle as ReturnType<typeof setInterval>));
  const onError =
    options.onError ??
    ((error: Error) => {
      console.warn(`[herdr] pane events: ${error.message}`);
    });

  const panes = new Map<string, PaneState>();
  let handle: SubscriptionHandle | undefined;
  let starting: Promise<void> | undefined;
  let stopped = false;
  let poll: TimerHandle | undefined;
  /** Tail-style guard: a slow snapshot makes the next tick skip, not pile up. */
  let polling = false;
  /** One warning per outage, not one per second. */
  let pollFailing = false;

  function run(work: Promise<void> | void): void {
    void Promise.resolve(work).catch((error: unknown) => {
      onError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  /** One pane observation, from an event or from a resync snapshot. */
  function observe(pane: Partial<PaneInfo>): void {
    const sessionId = pane.pane_id;
    if (!sessionId) return;

    const state = panes.get(sessionId) ?? {};
    const isNewPane = !panes.has(sessionId);
    panes.set(sessionId, state);

    // ── identity ────────────────────────────────────────────────────────────
    // An absent agent_session is "no claim", never "rotated to null": partially
    // reported panes omit the field, and dropping a live cursor on that would
    // lose the rest of the turn.
    const reported = pane.agent_session;
    if (reported !== undefined) {
      const value = reported?.value ?? null;
      if (isNewPane || state.sessionValue === undefined) {
        state.sessionValue = value;
        run(transcript?.attach(sessionId));
      } else if (state.sessionValue !== value) {
        state.sessionValue = value;
        run(transcript?.resetCursor(sessionId));
      }
    }

    // ── status ──────────────────────────────────────────────────────────────
    const status = typeof pane.agent_status === "string" ? pane.agent_status : undefined;
    // The daemon's own transition counter for this agent, when the carrier had
    // one (snapshot rows do, events do not). It moves on every status change,
    // so "same status, new seq" is proof that this pane went somewhere and came
    // back between two samples — the one thing status alone cannot show.
    const reportedSeq = (pane as { state_change_seq?: unknown }).state_change_seq;
    const seq = typeof reportedSeq === "number" ? reportedSeq : undefined;
    const previousSeq = state.seq;
    if (seq !== undefined) state.seq = seq;
    const seqAdvanced = seq !== undefined && previousSeq !== undefined && seq !== previousSeq;

    if (!status) return;
    const previous = state.status;
    const wasSettled = previous !== undefined && SETTLED_STATUSES.has(previous);

    if (status === previous) {
      // Nothing to re-announce: the status the phone holds is already right, and
      // repeating it would double every event the stream and the poll both see.
      // A settled status that is *not* the same one it was at the last sample
      // still means a whole turn ran in the gap, so it is read out.
      if (seqAdvanced && SETTLED_STATUSES.has(status)) {
        run(transcript?.deliverTurn(sessionId));
      }
      return;
    }
    state.status = status;

    // An unrecognised status is no claim at all — a daemon that invents one must
    // not be able to make the UI assert something wrong.
    const clientState = STATE_BY_AGENT_STATUS[status];
    if (clientState) {
      getSink(sessionId)?.({ type: "session_state", sessionId, state: clientState });
    }

    run(transcript?.onStatus(sessionId, status));
    // `blocked` is claude asking for permission; every other status means
    // whatever was pending has been answered by someone.
    run(permission?.onStatus(sessionId, status));
    // Deliver on ARRIVAL at a settled status — not on "left working" — so a
    // watcher that started mid-turn still reads that turn out (previous is
    // undefined then, and the fresh cursor sits at end of file, so it costs
    // nothing when there is no turn).
    //
    // `done` -> `idle` is the one settled pair that is NOT an arrival: it is a
    // turn already delivered on `done`, decaying. Draining the file there hands
    // the phone back the prompt it just typed and closes a turn that has not
    // started — visible as a spinner that stops the instant you hit send. Every
    // other settled-to-settled move (`idle` -> `done`, `done` -> `done`) only
    // happens because a turn ran in between, and is only believed when the
    // counter agrees.
    const decayingAfterDelivery = previous === "done" && status === "idle";
    const settledPairRanATurn = wasSettled && seqAdvanced && !decayingAfterDelivery;
    if (SETTLED_STATUSES.has(status) && (!wasSettled || settledPairRanATurn)) {
      run(transcript?.deliverTurn(sessionId));
    }
  }

  /** Every pane in a snapshot, with its agent's transition counter attached. */
  function observeSnapshot(snapshot: {
    panes?: Partial<PaneInfo>[];
    agents?: Partial<AgentInfo>[];
  }): void {
    for (const pane of panesWithSeq(snapshot)) observe(pane);
  }

  /**
   * One snapshot, every pane observed. Identical path to an event, so a status
   * the stream already reported is deduplicated rather than delivered twice.
   */
  async function pollOnce(): Promise<void> {
    if (!snapshot || polling || stopped) return;
    polling = true;
    try {
      observeSnapshot(await snapshot());
      pollFailing = false;
    } catch (error) {
      if (!pollFailing) {
        pollFailing = true;
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      polling = false;
    }
  }

  /**
   * Opens the one subscription. Never rejects: a failed subscription costs the
   * UI its activity indicator and its live readback, not its sessions.
   */
  async function start(): Promise<void> {
    if (stopped || handle || starting) return starting;
    starting = (async () => {
      try {
        const opened = await subscribe({
          subscriptions: [{ type: "pane.updated" }],
          onEvent: (event) => {
            const pane = paneFieldsOf(event);
            if (pane) observe(pane);
          },
          // The stream carries no sequence numbers, so a reconnect re-aligns
          // from a fresh snapshot instead of replaying the gap.
          onResync: (snapshot: SessionSnapshot) => {
            observeSnapshot(snapshot);
          },
          onError,
        });
        if (stopped) {
          opened.stop();
          return;
        }
        handle = opened;
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        starting = undefined;
      }

      // Armed even when the subscription failed: the poll is the status source
      // the stream never was, so a dead stream still leaves the phone with its
      // replies and its activity dots.
      if (snapshot && poll === undefined && !stopped) {
        poll = setIntervalFn(() => {
          void pollOnce();
        }, pollIntervalMs);
      }
    })();
    return starting;
  }

  /** Session gone: forget what it was doing, so a reused pane id starts clean. */
  function forget(sessionId: string): void {
    panes.delete(sessionId);
  }

  function stop(): void {
    stopped = true;
    handle?.stop();
    handle = undefined;
    if (poll !== undefined) {
      clearIntervalFn(poll);
      poll = undefined;
    }
    panes.clear();
  }

  return { start, stop, forget, observe };
}

export type HerdrPaneEvents = ReturnType<typeof createHerdrPaneEvents>;
