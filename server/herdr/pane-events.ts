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
 * What each signal drives:
 *   status change  → `session_state` to the client, plus the transcript tail
 *                    (armed while `working`) and a turn delivery when the
 *                    session settles.
 *   session change → the transcript cursor is dropped and re-taken at the new
 *                    file's end (`/clear` rotates the uuid and starts a new
 *                    file — research P6).
 */

import { STATE_BY_AGENT_STATUS } from "./agent-state";
import type { PaneInfo, SessionSnapshot } from "./schema";
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

export interface HerdrPaneEventsOptions {
  subscribe: (options: SubscribeEventsOptions) => Promise<SubscriptionHandle>;
  /** Late-bound sink lookup, so a reconnect that rebinds a session still gets events. */
  getSink: (sessionId: string) => ClientSink | undefined;
  transcript?: PaneEventTranscript;
  onError?: (error: Error) => void;
}

/** Statuses that mean "this turn is over" and therefore "read the transcript". */
const SETTLED_STATUSES = new Set(["idle", "done"]);

interface PaneState {
  status?: string;
  sessionValue?: string | null;
}

/** Pane fields, wherever this event kind happens to put them. */
function paneFieldsOf(event: { data?: unknown }): Partial<PaneInfo> | undefined {
  const data = event.data as Record<string, unknown> | null | undefined;
  if (!data || typeof data !== "object") return undefined;
  const nested = data.pane;
  const source = (nested && typeof nested === "object" ? nested : data) as Partial<PaneInfo>;
  return typeof source.pane_id === "string" ? source : undefined;
}

export function createHerdrPaneEvents(options: HerdrPaneEventsOptions) {
  const { subscribe, getSink, transcript } = options;
  const onError =
    options.onError ??
    ((error: Error) => {
      console.warn(`[herdr] pane events: ${error.message}`);
    });

  const panes = new Map<string, PaneState>();
  let handle: SubscriptionHandle | undefined;
  let starting: Promise<void> | undefined;
  let stopped = false;

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
    if (!status || status === state.status) return;
    const previous = state.status;
    state.status = status;

    // An unrecognised status is no claim at all — a daemon that invents one must
    // not be able to make the UI assert something wrong.
    const clientState = STATE_BY_AGENT_STATUS[status];
    if (clientState) {
      getSink(sessionId)?.({ type: "session_state", sessionId, state: clientState });
    }

    run(transcript?.onStatus(sessionId, status));
    // Deliver on arrival at a settled status rather than on "left working", so a
    // subscription that started mid-turn still reads that turn out.
    if (SETTLED_STATUSES.has(status) && previous !== status) {
      run(transcript?.deliverTurn(sessionId));
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
            for (const pane of snapshot.panes ?? []) observe(pane);
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
    panes.clear();
  }

  return { start, stop, forget, observe };
}

export type HerdrPaneEvents = ReturnType<typeof createHerdrPaneEvents>;
