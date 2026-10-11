import { posix } from "node:path";

export type StartResult = { ok: true } | { ok: false; reason: string };

export interface QueueEntry {
  key: string;
  /** What a log line calls this launch. Never the card's text or a credential. */
  label: string;
  start: () => Promise<StartResult>;
}

export type SubmitResult =
  | { kind: "started"; outcome: Promise<StartResult> }
  | { kind: "queued"; position: number }
  | { kind: "already_queued" }
  | { kind: "hangar_offline" };

export interface HangarStatus {
  cap: number;
  /** `null` is unknown (the hangar did not answer), never zero. */
  occupied: number | null;
  queued: number;
}

export interface LaunchQueueOptions {
  cap: number;
  occupancy: () => Promise<number | null>;
  intervalMs?: number;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  log?: (line: string) => void;
}

export interface LaunchQueue {
  submit(entry: QueueEntry): Promise<SubmitResult>;
  has(key: string): boolean;
  status(): Promise<HangarStatus>;
  /** Re-checks the waiting head now. Resolves once that check has run. */
  kick(): Promise<void>;
}

const DEFAULT_INTERVAL_MS = 10_000;

/** One card, whichever way its path was spelled. */
export function cardKey(vault: string, cardPath: string): string {
  return `${vault}\0${posix.normalize(cardPath)}`;
}

interface Reservation {
  key: string;
  /** Stamp of the finish; `null` while the launch is still running. */
  finishedAt: number | null;
}

/**
 * Admits launches while the hangar has a free slot and holds the rest in order.
 *
 * A launch the hangar has not listed yet would be invisible to a reading, so
 * each admitted launch holds a slot (a reservation) until a reading issued
 * after it finished. A reading issued at stamp t therefore counts the
 * reservations that were unfinished at t on top of what the hangar reported.
 * Decisions run one at a time, and a reservation is taken in the same
 * synchronous step as the decision to start.
 */
export function createLaunchQueue(options: LaunchQueueOptions): LaunchQueue {
  const log = options.log ?? ((line: string) => console.warn(line));
  const setIntervalFn =
    options.setIntervalFn ??
    ((fn: () => void, ms: number) => {
      const handle = setInterval(fn, ms);
      handle.unref?.();
      return handle;
    });
  const clearIntervalFn =
    options.clearIntervalFn ?? ((handle: unknown) => clearInterval(handle as Timer));

  const waiting: QueueEntry[] = [];
  const reservations = new Set<Reservation>();
  let counter = 0;
  let readingsInFlight = 0;
  let timer: unknown = null;
  let timerArmed = false;
  let chain: Promise<unknown> = Promise.resolve();

  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => {},
      () => {},
    );
    return run;
  };

  const syncTimer = () => {
    if (waiting.length > 0 && !timerArmed) {
      timerArmed = true;
      timer = setIntervalFn(() => {
        void serialize(() => decide());
      }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    } else if (waiting.length === 0 && timerArmed) {
      timerArmed = false;
      clearIntervalFn(timer);
    }
  };

  const heldAt = (stamp: number): number => {
    let held = 0;
    for (const r of reservations) if (r.finishedAt === null || r.finishedAt > stamp) held += 1;
    return held;
  };

  /**
   * What the hangar reports plus the launches that reading cannot have seen
   * finish; `null` when the hangar cannot say. Counted before the reading is
   * retired, since retiring one may prune the reservations it still needs.
   */
  async function read(): Promise<number | null> {
    const stamp = ++counter;
    readingsInFlight += 1;
    try {
      const count = await Promise.resolve()
        .then(options.occupancy)
        .catch(() => null);
      return count === null ? null : count + heldAt(stamp);
    } finally {
      readingsInFlight -= 1;
      if (readingsInFlight === 0) {
        for (const r of reservations) if (r.finishedAt !== null) reservations.delete(r);
      }
    }
  }

  function launch(entry: QueueEntry, dequeued: boolean): Promise<StartResult> {
    const reservation: Reservation = { key: entry.key, finishedAt: null };
    reservations.add(reservation);
    return (async (): Promise<StartResult> => {
      try {
        return await entry.start();
      } catch {
        return { ok: false, reason: "unexpected_error" };
      }
    })().then((result) => {
      reservation.finishedAt = ++counter;
      if (readingsInFlight === 0) reservations.delete(reservation);
      if (dequeued && !result.ok)
        log(`[launch-queue] ${entry.label} not started: ${result.reason}`);
      void serialize(() => decide());
      return result;
    });
  }

  /** Starts waiting launches head-first, then decides on `fresh`, on one reading. */
  async function decide(fresh?: QueueEntry): Promise<SubmitResult | undefined> {
    if (fresh && has(fresh.key)) return { kind: "already_queued" };
    if (waiting.length === 0 && !fresh) return undefined;
    let occupied = await read();
    if (occupied === null) return fresh ? { kind: "hangar_offline" } : undefined;
    while (waiting.length > 0 && occupied < options.cap) {
      const head = waiting.shift() as QueueEntry;
      occupied += 1;
      void launch(head, true);
    }
    syncTimer();
    if (!fresh) return undefined;
    if (waiting.length === 0 && occupied < options.cap) {
      return { kind: "started", outcome: launch(fresh, false) };
    }
    waiting.push(fresh);
    syncTimer();
    return { kind: "queued", position: waiting.length };
  }

  function has(key: string): boolean {
    for (const r of reservations) if (r.finishedAt === null && r.key === key) return true;
    return waiting.some((e) => e.key === key);
  }

  return {
    async submit(entry) {
      return (await serialize(() => decide(entry))) as SubmitResult;
    },
    has,
    async status() {
      return { cap: options.cap, occupied: await read(), queued: waiting.length };
    },
    async kick() {
      await serialize(() => decide());
    },
  };
}
