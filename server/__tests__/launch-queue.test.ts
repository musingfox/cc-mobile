import { describe, expect, test } from "bun:test";
import {
  cardKey,
  createLaunchQueue,
  type LaunchQueueOptions,
  type StartResult,
} from "../launch-queue";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function rig(opts: { cap: number; deferredReads?: boolean; intervalMs?: number }) {
  const source = {
    value: 0 as number | null | Error,
    deferredReads: opts.deferredReads ?? false,
    pending: [] as Deferred<number | null>[],
    calls: 0,
  };
  const timers = {
    set: [] as { fn: () => void; ms: number }[],
    cleared: 0,
  };
  const logs: string[] = [];
  const options: LaunchQueueOptions = {
    cap: opts.cap,
    occupancy: () => {
      source.calls += 1;
      if (source.deferredReads) {
        const d = deferred<number | null>();
        source.pending.push(d);
        return d.promise;
      }
      if (source.value instanceof Error) return Promise.reject(source.value);
      return Promise.resolve(source.value);
    },
    setIntervalFn: (fn, ms) => {
      timers.set.push({ fn, ms });
      return timers.set.length;
    },
    clearIntervalFn: () => {
      timers.cleared += 1;
    },
    log: (line) => logs.push(line),
    ...(opts.intervalMs !== undefined ? { intervalMs: opts.intervalMs } : {}),
  };
  const queue = createLaunchQueue(options);
  const tick = async () => {
    timers.set[timers.set.length - 1].fn();
    await flush();
  };
  return { queue, source, timers, logs, tick };
}

/** A start that records its invocation and finishes when told. */
function entry(name: string) {
  const d = deferred<StartResult>();
  const probe = { started: 0 };
  return {
    key: cardKey("v", `pm/p/tasks/${name}.md`),
    label: `v/pm/p/tasks/${name}.md`,
    start: () => {
      probe.started += 1;
      return d.promise;
    },
    finish: d,
    probe,
  };
}

describe("cardKey", () => {
  test("one card, whichever way its path is spelled", () => {
    expect(cardKey("v", "pm//p/tasks/a.md")).toBe(cardKey("v", "pm/p/tasks/./a.md"));
    expect(cardKey("v", "a.md")).not.toBe(cardKey("w", "a.md"));
  });
});

describe("OccupancyNeverExceedsCap", () => {
  test("T1 five concurrent submits against cap 4 start four", async () => {
    const { queue } = rig({ cap: 4 });
    const results = await Promise.all(["a", "b", "c", "d", "e"].map((n) => queue.submit(entry(n))));
    expect(results.filter((r) => r.kind === "started").length).toBe(4);
    expect(results[4]).toEqual({ kind: "queued", position: 1 });
  });

  test("T2 serialized reads start one of two on a cap of one", async () => {
    const { queue, source } = rig({ cap: 1, deferredReads: true });
    const a = queue.submit(entry("a"));
    const b = queue.submit(entry("b"));
    await flush();
    source.pending[0].resolve(0);
    await flush();
    source.pending[1]?.resolve(0);
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.kind).sort()).toEqual(["queued", "started"]);
  });

  test("T3 a reading issued before a finish does not release its slot", async () => {
    const { queue, source, tick } = rig({ cap: 1 });
    const a = entry("a");
    const b = entry("b");
    expect((await queue.submit(a)).kind).toBe("started");
    expect((await queue.submit(b)).kind).toBe("queued");
    source.deferredReads = true;
    await tick();
    expect(source.pending.length).toBe(1);
    a.finish.resolve({ ok: false, reason: "prompt_failed" });
    await flush();
    source.pending[0].resolve(0);
    await flush();
    expect(b.probe.started).toBe(0);
    source.pending[1].resolve(0);
    await flush();
    expect(b.probe.started).toBe(1);
  });

  test("T4 a reading after the finish that still lists the pane keeps the head waiting", async () => {
    const { queue, source } = rig({ cap: 1 });
    const a = entry("a");
    const b = entry("b");
    await queue.submit(a);
    await queue.submit(b);
    source.value = 1;
    a.finish.resolve({ ok: true });
    await flush();
    expect(b.probe.started).toBe(0);
    source.value = 0;
    await queue.kick();
    expect(b.probe.started).toBe(1);
  });

  test("T5 status counts a running launch on top of the reading", async () => {
    const { queue, source } = rig({ cap: 2 });
    await queue.submit(entry("a"));
    source.value = 1;
    expect((await queue.status()).occupied).toBe(2);
  });

  test("T6 an occupancy rejection is offline and starts nothing", async () => {
    const { queue, source } = rig({ cap: 1 });
    source.value = new Error("x");
    const e = entry("a");
    expect(await queue.submit(e)).toEqual({ kind: "hangar_offline" });
    expect(e.probe.started).toBe(0);
  });
});

describe("QueuedLaunchRechecksOnFinish", () => {
  async function full() {
    const r = rig({ cap: 1 });
    const a = entry("a");
    const b = entry("b");
    await r.queue.submit(a);
    await r.queue.submit(b);
    return { ...r, a, b };
  }

  test("T1 a failed finish starts the head with no tick", async () => {
    const { a, b } = await full();
    a.finish.resolve({ ok: false, reason: "terminal_error" });
    await flush();
    expect(b.probe.started).toBe(1);
  });

  test("T2 a rejected start starts the head", async () => {
    const { a, b } = await full();
    a.finish.reject(new Error("x"));
    await flush();
    expect(b.probe.started).toBe(1);
  });

  test("T3 a successful finish with a free reading starts the head", async () => {
    const { a, b } = await full();
    a.finish.resolve({ ok: true });
    await flush();
    expect(b.probe.started).toBe(1);
  });

  test("T4 a successful finish whose reading is still full re-reads and keeps waiting", async () => {
    const { a, b, source } = await full();
    source.value = 1;
    const before = source.calls;
    a.finish.resolve({ ok: true });
    await flush();
    expect(b.probe.started).toBe(0);
    expect(source.calls).toBe(before + 1);
  });
});

describe("QueuedLaunchStartsOnPoll", () => {
  test("T1 a free tick starts the waiting launches in order", async () => {
    const { queue, source, tick } = rig({ cap: 3 });
    source.value = 3;
    const order: string[] = [];
    const mk = (n: string) => ({
      ...entry(n),
      start: () => {
        order.push(n);
        return new Promise<StartResult>(() => {});
      },
    });
    for (const n of ["a", "b", "c"]) await queue.submit(mk(n));
    source.value = 0;
    await tick();
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("T2 only the free slots start", async () => {
    const { queue, source, tick } = rig({ cap: 2 });
    source.value = 2;
    const es = ["a", "b", "c"].map(entry);
    for (const e of es) await queue.submit(e);
    source.value = 0;
    await tick();
    expect(es.map((e) => e.probe.started)).toEqual([1, 1, 0]);
    expect((await queue.status()).queued).toBe(1);
  });

  test("T3 an unknown reading starts nothing and keeps every position", async () => {
    const { queue, source, tick } = rig({ cap: 1 });
    source.value = 1;
    const a = entry("a");
    await queue.submit(a);
    source.value = null;
    await tick();
    expect(a.probe.started).toBe(0);
    expect((await queue.status()).queued).toBe(1);
    source.value = 0;
    await tick();
    expect(a.probe.started).toBe(1);
  });
});

describe("QueuePollRunsOnlyWhileWaiting", () => {
  test("T1 an idle queue holds no timer and reads nothing", () => {
    const { timers, source } = rig({ cap: 1 });
    expect(timers.set.length).toBe(0);
    expect(source.calls).toBe(0);
  });

  test("T2 the timer is armed once at 10 000 ms", async () => {
    const { queue, source, timers } = rig({ cap: 1 });
    source.value = 1;
    await queue.submit(entry("a"));
    await queue.submit(entry("b"));
    expect(timers.set.length).toBe(1);
    expect(timers.set[0].ms).toBe(10_000);
  });

  test("T3 the timer is cleared once when nothing waits", async () => {
    const { queue, source, timers, tick } = rig({ cap: 2 });
    source.value = 2;
    await queue.submit(entry("a"));
    await queue.submit(entry("b"));
    source.value = 0;
    await tick();
    expect(timers.cleared).toBe(1);
  });

  test("T4 intervalMs is passed through", async () => {
    const { queue, source, timers } = rig({ cap: 1, intervalMs: 50 });
    source.value = 1;
    await queue.submit(entry("a"));
    expect(timers.set[0].ms).toBe(50);
  });
});

describe("HangarStatus", () => {
  test("T3 cap 1, reading 1, two waiting", async () => {
    const { queue, source } = rig({ cap: 1 });
    source.value = 1;
    await queue.submit(entry("a"));
    await queue.submit(entry("b"));
    expect(await queue.status()).toEqual({ cap: 1, occupied: 1, queued: 2 });
  });

  test("T4 an unknown reading is null, not zero", async () => {
    const { queue, source } = rig({ cap: 4 });
    source.value = null;
    expect(await queue.status()).toEqual({ cap: 4, occupied: null, queued: 0 });
  });

  test("T5 status never starts a waiting launch", async () => {
    const { queue, source } = rig({ cap: 1 });
    source.value = 1;
    const a = entry("a");
    await queue.submit(a);
    source.value = 0;
    const status = await queue.status();
    expect(a.probe.started).toBe(0);
    expect(status.queued).toBe(1);
  });
});

describe("DequeueFailureLogsOnly queue", () => {
  test("T5 a rejected dequeued start logs its label and unexpected_error once", async () => {
    const { queue, source, logs, tick } = rig({ cap: 1 });
    source.value = 1;
    const a = entry("a");
    await queue.submit(a);
    source.value = 0;
    a.finish.reject(new Error("secret detail"));
    await tick();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain(a.label);
    expect(logs[0]).toContain("unexpected_error");
    expect(logs[0]).not.toContain("secret detail");
  });

  test("a launch admitted at once logs nothing when it fails", async () => {
    const { queue, logs } = rig({ cap: 1 });
    const a = entry("a");
    const result = await queue.submit(a);
    a.finish.resolve({ ok: false, reason: "terminal_error" });
    if (result.kind === "started") await result.outcome;
    await flush();
    expect(logs).toEqual([]);
  });
});

describe("DuplicateCardRefused queue", () => {
  test("a key waiting or running is refused and the queue is unchanged", async () => {
    const { queue, source } = rig({ cap: 1 });
    const a = entry("a");
    expect((await queue.submit(a)).kind).toBe("started");
    expect(await queue.submit(entry("a"))).toEqual({ kind: "already_queued" });
    source.value = 1;
    await queue.submit(entry("b"));
    source.value = null;
    expect(await queue.submit(entry("b"))).toEqual({ kind: "already_queued" });
    expect((await queue.status()).queued).toBe(1);
  });
});
