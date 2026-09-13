/**
 * notifier.ts — when a pane may buzz a phone, and which panes may.
 *
 * Timing reads herdr's own words. `blocked` is the one state that stays stuck
 * until somebody answers, so it sends at once — once per episode, because the
 * pane is polled and an episode is one question, not one question per sample.
 * `done` — idle and not yet seen — opens a window instead of sending, and the
 * first window to expire flushes every pane pending at that moment as a single
 * notification: several sessions finishing together are one thing to know, and
 * the payload names no pane anyway (it crosses APNs, so it carries nothing).
 *
 * `idle` is not end-of-turn. It means "not busy", which includes a pane that
 * never ran anything, so it initiates nothing — and it cancels nothing either:
 * a `done` that gets marked seen decays to `idle`, and that is the same turn,
 * not a new one. Every other status cancels: work restarted, or the daemon
 * lost track, and a completion nobody is waiting for should not arrive late.
 *
 * `phone-last` (the default) notifies about a pane whose most recent input came
 * from the phone: the work you asked for while away is the work worth a buzz,
 * and a pane you are typing into at the desk is not. `all` notifies about every
 * pane on the machine.
 *
 * The scope verdict is taken when the turn ends, never when the timer fires.
 * Read 45 seconds later it would be a verdict another turn has since spent,
 * and this module decides *when* to send, never *to whom*.
 */

import type { PhoneDrivenTracker } from "./phone-driven";
import type { PushSubscription, VapidConfig } from "./sender";

/** Which panes may buzz a phone. Set by `CC_MOBILE_PUSH_SCOPE`. */
export type PushScope = "phone-last" | "all";

/** How long finished turns are collected before one notification goes out. */
export const TURN_PUSH_WINDOW_MS = 45_000;

type TimerHandle = unknown;

export interface NotifierTimers {
  setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
}

export interface NotifierOptions extends NotifierTimers {
  scope?: PushScope;
  phoneDriven?: PhoneDrivenTracker;
  dispatch: (
    kind: "turn" | "permission",
    subs: PushSubscription[],
    vapid?: VapidConfig,
  ) => Promise<{ attempted: number }>;
  getSubscriptions: () => PushSubscription[];
  getVapid?: () => VapidConfig | null;
  warn?: (message: string) => void;
}

export function createPushNotifier(opts: NotifierOptions) {
  const scope: PushScope = opts.scope ?? "phone-last";
  const phoneDriven = opts.phoneDriven;
  // Defaults to "push is not configured". A placeholder key pair here would
  // sail past the sender's guard and produce sends that can never arrive.
  const getVapid = opts.getVapid ?? (() => null);
  const warn = opts.warn ?? ((message: string) => console.warn(`[push] ${message}`));
  const setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let warnedNoTracker = false;
  /** Panes whose finished turn is waiting out its window. */
  const pending = new Map<string, { timer: TimerHandle }>();

  /**
   * Whether this pane is in scope. `all` asks nothing; `phone-last` asks the
   * tracker, and with no tracker wired it fails closed and says so once — a
   * silent "no" here is the one outcome that looks exactly like a working
   * install that simply has nothing to report.
   */
  function inScope(paneId: string): boolean {
    if (scope === "all") return true;
    if (!phoneDriven) {
      if (!warnedNoTracker) {
        warnedNoTracker = true;
        warn(
          "push scope is phone-last but no send tracker is wired — nothing will be sent. This is a wiring bug, not a quiet machine.",
        );
      }
      return false;
    }
    return phoneDriven.isPhoneDriven(paneId);
  }

  /**
   * The subscriptions this pane may be announced to, or null for "nobody".
   * One admission check, so the two callers cannot drift apart on the order
   * they ask the questions in.
   */
  function admit(paneId: string): PushSubscription[] | null {
    const subs = opts.getSubscriptions();
    if (subs.length === 0) return null;
    if (!inScope(paneId)) return null;
    return subs;
  }

  async function send(kind: "turn" | "permission", subs: PushSubscription[]) {
    await opts.dispatch(kind, subs, getVapid() ?? undefined);
  }

  function drop(paneId: string): void {
    const entry = pending.get(paneId);
    if (!entry) return;
    clearTimeoutFn(entry.timer);
    pending.delete(paneId);
  }

  function flush(): void {
    // One pane's deadline flushes the machine-wide batch. Clear every other
    // timer before dispatch so it cannot trail behind as another vibration.
    if (pending.size === 0) return;
    for (const entry of pending.values()) clearTimeoutFn(entry.timer);
    pending.clear();
    const subs = opts.getSubscriptions();
    if (subs.length === 0) return;
    void send("turn", subs).catch((error: unknown) =>
      warn(`turn push failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  async function onAgentStatus(paneId: string, status: string): Promise<void> {
    // `idle` neither opens a window nor closes one; see the header.
    if (status === "idle") return;

    // Whatever was pending for this pane is answered by this status, whichever
    // branch runs below: a fresh window replaces it, work restarting cancels
    // it, and a pane that has fallen out of scope must not keep an armed timer
    // that fires on a verdict nobody would grant it now.
    drop(paneId);

    if (status === "done") {
      const subs = admit(paneId);
      if (!subs) return;
      pending.set(paneId, { timer: setTimeoutFn(flush, TURN_PUSH_WINDOW_MS) });
      return;
    }

    if (status !== "blocked") return;
    const subs = admit(paneId);
    if (!subs) return;
    try {
      await send("permission", subs);
    } catch (error) {
      warn(`permission push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The pane is gone; discard anything queued for it. */
  function forget(paneId: string): void {
    drop(paneId);
  }

  return { onAgentStatus, forget };
}
