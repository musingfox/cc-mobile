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
  /**
   * `kind` is the last agent kind this pane reported, `undefined` while herdr
   * has reported none — the caller decides what an unknown kind means, this
   * module only remembers what was said.
   */
  onStatus(sessionId: string, status: string, kind?: string): Promise<void> | void;
}

/** Handle returned by the injected interval scheduler. */
export type TimerHandle = unknown;

export const DEFAULT_STATUS_POLL_MS = 1_000;

/**
 * Tick multipliers for the snapshot RPC. The timer keeps its 1 s beat; what
 * these decide is how many beats pass between two calls to the daemon, which is
 * what actually costs a unix connection (one per RPC — see transport.ts).
 *
 *   full speed   a phone is connected and a claude is running: the settle has to
 *                reach the phone inside a second, so every tick calls.
 *   discovery    a phone is connected but no claude has been seen yet: nothing
 *                to read back, only a new pane to notice. The stream notices it
 *                sooner anyway (any event forces the next tick to call).
 *   push         no phone connected, but a push subscription is registered: poll
 *                every ~3 s so a finished turn can trigger a push notification.
 *   dormant      nobody is listening and no push subs. Anything read here would
 *                be dropped, so this is close to off — kept alive only so a
 *                daemon restart is eventually noticed.
 */
const DISCOVERY_POLL_TICKS = 5;
const DORMANT_POLL_TICKS = 30;
/** Intermediate tier: push subscribers exist but no live client. ~3 s. */
const PUSH_SUBSCRIBER_POLL_TICKS = 3;

export interface HerdrPaneEventsOptions {
  subscribe: (options: SubscribeEventsOptions) => Promise<SubscriptionHandle>;
  /** Late-bound sink lookup, so a reconnect that rebinds a session still gets events. */
  getSink: (sessionId: string) => ClientSink | undefined;
  /**
   * Whether any phone is currently connected. Defaults to "always", which is
   * what this module assumed before the poll learned to back off.
   */
  hasClients?: () => boolean;
  /**
   * Whether any push subscribers are registered (for the push poll tier).
   * When no clients but push subs exist, poll at an intermediate rate (~3s)
   * instead of dormant (30s). Omitted or false keeps dormant behaviour.
   */
  hasPushSubscribers?: () => boolean;
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
  /**
   * This pane left a settled status — a turn began, whoever started it. The
   * push scope rule reads it to tell a turn the phone asked for apart from one
   * typed at the terminal, so it must fire for both.
   */
  onTurnStart?: (sessionId: string) => void;
  /** Separate settle announcement for the phone-driven tracker. */
  onTurnSettled?: (sessionId: string) => Promise<void> | void;
  /** Every raw daemon status observation, including counter-proved repeats. */
  onAgentStatus?: (sessionId: string, status: string) => Promise<void> | void;
  onError?: (error: Error) => void;
}

/** Statuses that mean "this turn is over" and therefore "read the transcript". */
const SETTLED_STATUSES = new Set(["idle", "done"]);

interface PaneState {
  status?: string;
  sessionValue?: string | null;
  /** Last `state_change_seq` seen for this pane; see `observe`. */
  seq?: number;
  /** Last agent kind this pane reported; see `observe`. */
  kind?: string;
  /** A blocked episode has already reached the push hook. */
  blockedNotified?: boolean;
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
  const hasClients = options.hasClients ?? (() => true);
  const hasPushSubscribers = options.hasPushSubscribers ?? (() => false);
  const onTurnStart = options.onTurnStart;
  const onTurnSettled = options.onTurnSettled;
  const onAgentStatus = options.onAgentStatus;
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
  /** Whether the last snapshot found a claude anywhere on the machine. */
  let claudeRunning = false;
  /** Ticks passed since the last snapshot RPC. */
  let ticksWaited = 0;
  /** Something arrived on the stream: re-read the whole picture on the next tick. */
  let dueNext = false;

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

    // ── kind ────────────────────────────────────────────────────────────────
    // Sticky, for the same reason the session value is: a partial report omits
    // the field, and forgetting the kind there would make the next `blocked`
    // look like a pane herdr has said nothing about. An empty string is the
    // daemon saying "not detected", so it is not a report either. `forget()`
    // clears it, which is what makes a reused pane id start from nothing.
    const reportedKind = typeof pane.agent === "string" ? pane.agent : undefined;
    if (reportedKind) state.kind = reportedKind;

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
    const statusChanged = status !== previous;

    // This is deliberately wider than turn delivery: push must see raw daemon
    // status reports, including an event-carried idle→done and a new counter
    // that proves a same-status turn. A blocked pane is the exception: polling
    // it repeatedly is one permission episode, not repeated buzzes.
    if ((statusChanged || seqAdvanced) && (status !== "blocked" || !state.blockedNotified)) {
      if (status === "blocked") state.blockedNotified = true;
      run(onAgentStatus?.(sessionId, status));
    }
    if (status !== "blocked") state.blockedNotified = false;

    if (status === previous) {
      // Nothing to re-announce: the status the phone holds is already right, and
      // repeating it would double every event the stream and the poll both see.
      // A settled status that is *not* the same one it was at the last sample
      // still means a whole turn ran in the gap, so it is read out.
      if (seqAdvanced && SETTLED_STATUSES.has(status)) {
        run(transcript?.deliverTurn(sessionId));
        run(onTurnSettled?.(sessionId));
      }
      return;
    }
    state.status = status;

    // Leaving a settled status is a turn beginning. Reported before anything
    // else acts on the change, so the scope verdict is already right by the
    // time a prompt or a settle on this same pane is announced.
    if (wasSettled && !SETTLED_STATUSES.has(status)) onTurnStart?.(sessionId);

    // An unrecognised status is no claim at all — a daemon that invents one must
    // not be able to make the UI assert something wrong.
    const clientState = STATE_BY_AGENT_STATUS[status];
    if (clientState) {
      getSink(sessionId)?.({ type: "session_state", sessionId, state: clientState });
    }

    run(transcript?.onStatus(sessionId, status));
    // `blocked` is claude asking for permission; every other status means
    // whatever was pending has been answered by someone.
    run(permission?.onStatus(sessionId, status, state.kind));
    // Deliver on ARRIVAL at a settled status — not on "left working" — so a
    // watcher that started mid-turn still reads that turn out (previous is
    // undefined then, and the fresh cursor sits at end of file, so it costs
    // nothing when there is no turn).
    //
    // `done` -> `idle` is the one settled pair that is NOT an arrival: it means
    // the completion was seen, typically after a focus-driven refresh. cc-mobile
    // never focuses a pane (`registry.ts` launches with `focus:false`), so this
    // must not drain the prompt the phone just typed or close a turn that has
    // not started. Other settled pairs are believed only when the counter agrees.
    const seenAfterDelivery = previous === "done" && status === "idle";
    const settledPairRanATurn = wasSettled && seqAdvanced && !seenAfterDelivery;
    if (SETTLED_STATUSES.has(status) && (!wasSettled || settledPairRanATurn)) {
      run(transcript?.deliverTurn(sessionId));
      run(onTurnSettled?.(sessionId));
      // An event has no counter. It already emitted this arrival, so discard
      // the snapshot counter it was compared against; the next snapshot must
      // not emit the same turn again. Do this only here: clearing it on every
      // event-path status would erase a real turn after idle→done.
      if (seq === undefined) state.seq = undefined;
    }
  }

  /** Every pane in a snapshot, with its agent's transition counter attached. */
  function observeSnapshot(current: {
    panes?: Partial<PaneInfo>[];
    agents?: Partial<AgentInfo>[];
  }): void {
    const rows = panesWithSeq(current);
    // "Is there anything to watch": a detected claude, or a pane reporting a
    // status only an agent has. A shell prompt reports `unknown` and does not
    // count — it is the whole machine sitting idle that the poll backs off for.
    claudeRunning =
      (current.agents ?? []).some((agent) => agent.agent === "claude") ||
      rows.some(
        (pane) =>
          pane.agent === "claude" ||
          (typeof pane.agent_status === "string" &&
            STATE_BY_AGENT_STATUS[pane.agent_status] !== undefined),
      );
    for (const pane of rows) observe(pane);
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
   * Whether this tick calls the daemon. Skipping is not a delay in noticing a
   * turn's end: `state_change_seq` makes a settle that happened between two
   * calls just as visible as one sampled live, which is what lets the rate drop
   * at all (see `observe`).
   */
  function dueThisTick(): boolean {
    const every = !hasClients()
      ? hasPushSubscribers()
        ? PUSH_SUBSCRIBER_POLL_TICKS
        : DORMANT_POLL_TICKS
      : claudeRunning
        ? 1
        : DISCOVERY_POLL_TICKS;
    ticksWaited += 1;
    // A stream event only shortcuts a wait somebody is waiting on: with no
    // phone connected, a working claude retitles its pane every second and
    // would otherwise hold the poll at full speed for nobody.
    const shortcut = dueNext && hasClients();
    if (ticksWaited < every && !shortcut) return false;
    ticksWaited = 0;
    dueNext = false;
    return true;
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
            if (!pane) return;
            // Events carry no counter and may report a pane partially, so one
            // is a reason to take a full snapshot rather than a substitute for
            // it: a backed-off poll catches up on the next tick.
            dueNext = true;
            observe(pane);
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
        // Prime so that when clients present at arm we get the free first poll
        // (old DORMANT trick); when !clients (push or dormant) we start from 0
        // so the tier rhythm (3 or 30) governs including first poll time.
        ticksWaited = hasClients() ? DORMANT_POLL_TICKS : 0;
        poll = setIntervalFn(() => {
          if (dueThisTick()) void pollOnce();
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
