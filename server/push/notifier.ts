/**
 * notifier.ts — the scope gate between a trigger and a send.
 *
 * Both triggers pass through here so the rule is written once.
 *
 * `phone-last` (the default) notifies about a pane whose most recent input came
 * from the phone: the work you asked for while away is the work worth a buzz,
 * and a pane you are typing into at the desk is not. `all` notifies about every
 * pane on the machine.
 *
 * This replaces the original rule, which notified only about panes cc-mobile
 * itself launched. That one was silent in practice — a machine's panes are
 * mostly started in a terminal, and driving one from the phone did not make it
 * eligible — and it contradicted the #29/#30 direction that a terminal-started
 * session is not a second-class one.
 */

import type { PhoneDrivenTracker } from "./phone-driven";
import type { PushSubscription, VapidConfig } from "./sender";

/** Which panes may buzz a phone. Set by `CC_MOBILE_PUSH_SCOPE`. */
export type PushScope = "phone-last" | "all";

export interface NotifierOptions {
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
  const dispatch = opts.dispatch;
  const getSubs = opts.getSubscriptions;
  // Defaults to "push is not configured". A placeholder key pair here would
  // sail past the sender's guard and produce sends that can never arrive.
  const getVapid = opts.getVapid ?? (() => null);
  const warn = opts.warn ?? ((message: string) => console.warn(`[push] ${message}`));
  let warnedNoTracker = false;

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

  async function send(kind: "turn" | "permission", subs: PushSubscription[]) {
    await dispatch(kind, subs, getVapid() ?? undefined);
  }

  async function onTurnSettled(paneId: string) {
    // Subscriber check first: a machine nobody has subscribed from does no
    // scope work at all, on every settled turn of every pane.
    const subs = getSubs();
    if (subs.length === 0) return;
    if (!inScope(paneId)) return;
    await send("turn", subs);
  }

  async function onPermissionPrompt(paneId: string) {
    const subs = getSubs();
    if (subs.length === 0) return;
    // Same verdict as the turn it belongs to: a prompt is raised *inside* the
    // turn, so a permission question that came out of something asked from the
    // phone is asked of the phone.
    if (!inScope(paneId)) return;
    await send("permission", subs);
  }

  return { onTurnSettled, onPermissionPrompt };
}
