/**
 * notifier.ts — the scope gate between a trigger and a send.
 *
 * Only sessions cc-mobile itself started may buzz a phone (Decision D1). Both
 * triggers pass through here so the rule is written once.
 */

import type { PushSubscription, VapidConfig } from "./sender";

export interface NotifierOptions {
  getOrigin?: (paneId: string) => Promise<"self" | "foreign">;
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
  const getOrigin = opts.getOrigin ?? (async () => "self" as const);
  const dispatch = opts.dispatch;
  const getSubs = opts.getSubscriptions;
  // Defaults to "push is not configured". A placeholder key pair here would
  // sail past the sender's guard and produce sends that can never arrive.
  const getVapid = opts.getVapid ?? (() => null);
  const warn = opts.warn ?? ((message: string) => console.warn(`[push] ${message}`));
  let warnedOriginLookup = false;

  /**
   * A pane whose origin cannot be established is foreign: the scope rule fails
   * closed. Warned once, because a lookup that is broken is broken for every
   * turn after it too.
   */
  async function originOf(paneId: string): Promise<"self" | "foreign"> {
    try {
      return await getOrigin(paneId);
    } catch (error) {
      if (!warnedOriginLookup) {
        warnedOriginLookup = true;
        warn(
          `cannot determine which pane a push belongs to (${String(error)}) — treating panes as foreign, so nothing is sent`,
        );
      }
      return "foreign";
    }
  }

  async function send(kind: "turn" | "permission", subs: PushSubscription[]) {
    await dispatch(kind, subs, getVapid() ?? undefined);
  }

  async function onTurnSettled(paneId: string) {
    // Subscriber check first, and it is load-bearing: a machine nobody has
    // subscribed from must never pay the `agent.list` RPC the origin lookup
    // costs, on every settled turn.
    const subs = getSubs();
    if (subs.length === 0) return;
    if ((await originOf(paneId)) !== "self") return;
    await send("turn", subs);
  }

  async function onPermissionPrompt(paneId: string, originHint?: "self" | "foreign") {
    const subs = getSubs();
    if (subs.length === 0) return;
    // The origin recorded when the prompt was emitted, when there is one: it
    // saves a second listing and matches what gated the unattended deny.
    const origin = originHint ?? (await originOf(paneId));
    if (origin !== "self") return;
    await send("permission", subs);
  }

  return { onTurnSettled, onPermissionPrompt };
}
