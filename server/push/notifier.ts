/** Push timing and scope gate. */

import type { PhoneDrivenTracker } from "./phone-driven";
import type { PushSubscription, VapidConfig } from "./sender";

export type PushScope = "phone-last" | "all";
export const TURN_PUSH_WINDOW_MS = 45_000;
type TimerHandle = unknown;
export interface NotifierTimers {
  setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
}

export interface NotifierOptions extends NotifierTimers {
  scope?: PushScope;
  phoneDriven?: PhoneDrivenTracker;
  dispatch: (kind: "turn" | "permission", subs: PushSubscription[], vapid?: VapidConfig) => Promise<{ attempted: number }>;
  getSubscriptions: () => PushSubscription[];
  getVapid?: () => VapidConfig | null;
  warn?: (message: string) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
}

export function createPushNotifier(opts: NotifierOptions) {
  const scope = opts.scope ?? "phone-last";
  const getVapid = opts.getVapid ?? (() => null);
  const warn = opts.warn ?? ((message) => console.warn(`[push] ${message}`));
  const setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn = opts.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let warnedNoTracker = false;
  const pending = new Map<string, { timer: TimerHandle }>();

  function inScope(paneId: string): boolean {
    if (scope === "all") return true;
    if (!opts.phoneDriven) {
      if (!warnedNoTracker) {
        warnedNoTracker = true;
        warn("push scope is phone-last but no send tracker is wired — nothing will be sent. This is a wiring bug, not a quiet machine.");
      }
      return false;
    }
    return opts.phoneDriven.isPhoneDriven(paneId);
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
    if (status === "done") {
      const subs = opts.getSubscriptions();
      // Capture scope at turn end, rather than when the delayed callback runs.
      if (subs.length === 0 || !inScope(paneId)) return;
      drop(paneId);
      const timer = setTimeoutFn(flush, TURN_PUSH_WINDOW_MS);
      pending.set(paneId, { timer });
      return;
    }
    if (status === "idle") return;
    drop(paneId);
    if (status !== "blocked") return;
    const subs = opts.getSubscriptions();
    if (subs.length === 0 || !inScope(paneId)) return;
    try {
      await send("permission", subs);
    } catch (error) {
      warn(`permission push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function forget(paneId: string): void {
    drop(paneId);
  }

  return { onAgentStatus, forget };
}
