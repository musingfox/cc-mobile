import { classifyHerdrFailure } from "./errors";
import type { TimerHandle } from "./pane-events";
import type { Side } from "./sides";

const DEFAULT_INTERVAL_MS = 10_000;

export type SocketStatus = "unknown" | "online" | "unreachable" | "incompatible";

export interface SocketWatchOptions {
  side: Side;
  socketPath: string;
  probe: () => Promise<unknown>;
  intervalMs?: number;
  offlineAlarm?: { afterMs: number; onAlarm: () => Promise<unknown> | void };
  now?: () => number;
  setIntervalFn?: (fn: () => void, ms: number) => TimerHandle;
  clearIntervalFn?: (handle: TimerHandle) => void;
  warn?: (message: string) => void;
}

/** Per-socket verdict on whether a herdr daemon is usable, refreshed by polling. */
export function createSocketWatch(options: SocketWatchOptions) {
  const { side, socketPath, probe, offlineAlarm } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => console.warn(message));
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

  let status: SocketStatus = "unknown";
  let handle: TimerHandle | undefined;
  let inFlight = false;
  let warnedDown = false;
  let episodeStart: number | undefined;
  let alarmed = false;

  function safely(callback: () => Promise<unknown> | void, label: string): void {
    Promise.resolve()
      .then(callback)
      .catch((error: unknown) => {
        warn(`[herdr] ${side} ${label}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  function onOnline(): void {
    if (warnedDown) warn(`[herdr] ${side} socket ${socketPath} recovered`);
    status = "online";
    warnedDown = false;
    episodeStart = undefined;
    alarmed = false;
  }

  function onFailure(error: unknown): void {
    const previous = status;
    status = classifyHerdrFailure(error);
    if (!warnedDown || status !== previous) {
      warnedDown = true;
      const reason = error instanceof Error ? error.message : String(error);
      const kind =
        status === "incompatible"
          ? `speaks an incompatible protocol (${reason})`
          : `is unreachable (${reason})`;
      warn(`[herdr] ${side} socket ${socketPath} ${kind}`);
    }
    const t = now();
    episodeStart ??= t;
    if (offlineAlarm && !alarmed && t - episodeStart >= offlineAlarm.afterMs) {
      alarmed = true;
      safely(offlineAlarm.onAlarm, "offline alarm");
    }
  }

  function tick(): void {
    if (inFlight) return;
    inFlight = true;
    Promise.resolve()
      .then(probe)
      .then(onOnline, onFailure)
      .catch((error: unknown) => {
        warn(`[herdr] ${side} watch: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        inFlight = false;
      });
  }

  return {
    start(): void {
      if (handle !== undefined) return;
      handle = setIntervalFn(tick, intervalMs);
      tick();
    },
    stop(): void {
      if (handle === undefined) return;
      clearIntervalFn(handle);
      handle = undefined;
    },
    status: (): SocketStatus => status,
  };
}

export type SocketWatch = ReturnType<typeof createSocketWatch>;
