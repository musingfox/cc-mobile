import { describe, expect, it } from "bun:test";
import { HerdrRpcError } from "./errors";
import { type EventEnvelope, type SessionSnapshot, SessionSnapshotSchema } from "./schema";
import { type SubscribeDeps, subscribeEvents } from "./subscribe";
import type { HerdrConnect, HerdrConnectHandlers } from "./transport";
import {
  EVENT_LINE_1,
  EVENT_LINE_2,
  PANE_NOT_FOUND_ERROR_LINE,
  SESSION_SNAPSHOT_LINE,
  SUBSCRIPTION_ACK_LINE,
} from "./wire-fixtures";

const SUBSCRIPTION_SPEC = {
  type: "pane.output_matched",
  pane_id: "pane-1",
  source: "visible",
  match: { type: "substring", value: "HERDR_SMOKE" },
};

/** Flushes pending microtasks + one macrotask turn. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeSession {
  written: string[];
  ended: boolean;
  handlers: HerdrConnectHandlers;
  pushLine(line: string): void;
  close(): void;
}

/** Fake long-lived connection factory; the test scripts ack/event/close per session. */
function fakeSubscriptionConnect() {
  const sessions: FakeSession[] = [];
  let connectAttempts = 0;
  let failNextConnects = 0;
  const connect: HerdrConnect = async (handlers) => {
    connectAttempts += 1;
    if (failNextConnects > 0) {
      failNextConnects -= 1;
      throw new Error("connect ECONNREFUSED");
    }
    const session: FakeSession = {
      written: [],
      ended: false,
      handlers,
      pushLine(line: string) {
        handlers.onData(`${line}\n`);
      },
      close() {
        handlers.onClose();
      },
    };
    sessions.push(session);
    return {
      write(data: string) {
        session.written.push(data);
      },
      end() {
        session.ended = true;
      },
    };
  };
  return {
    connect,
    sessions,
    attempts: () => connectAttempts,
    failNext: (n: number) => {
      failNextConnects = n;
    },
  };
}

function parsedSnapshotFixture(): SessionSnapshot {
  const { result } = JSON.parse(SESSION_SNAPSHOT_LINE) as {
    result: { snapshot: unknown };
  };
  return SessionSnapshotSchema.parse(result.snapshot);
}

function baseDeps(connect: HerdrConnect, extra: Partial<SubscribeDeps> = {}): SubscribeDeps {
  return {
    connect,
    fetchSnapshot: async () => parsedSnapshotFixture(),
    ...extra,
  };
}

describe("herdr subscribe: EventSubscription", () => {
  it("T1: resolves after ack, then delivers parsed events in order", async () => {
    const fake = fakeSubscriptionConnect();
    const events: EventEnvelope[] = [];
    const startPromise = subscribeEvents(
      { subscriptions: [SUBSCRIPTION_SPEC], onEvent: (e) => events.push(e) },
      baseDeps(fake.connect),
    );
    await flush();

    const request = JSON.parse(fake.sessions[0]?.written[0] ?? "") as Record<string, unknown>;
    expect(request.method).toBe("events.subscribe");
    expect(request.params).toEqual({ subscriptions: [SUBSCRIPTION_SPEC] });

    expect(events.length).toBe(0);
    fake.sessions[0]?.pushLine(SUBSCRIPTION_ACK_LINE);
    await startPromise;

    fake.sessions[0]?.pushLine(EVENT_LINE_1);
    fake.sessions[0]?.pushLine(EVENT_LINE_2);
    await flush();

    expect(events.length).toBe(2);
    expect(events[0]?.event).toBe("pane.output_matched");
    expect(events[0]?.data).toEqual((JSON.parse(EVENT_LINE_1) as { data: unknown }).data);
    expect(events[1]?.data).toEqual((JSON.parse(EVENT_LINE_2) as { data: unknown }).data);
  });

  it("T2: rejects the start promise with HerdrRpcError when the daemon replies an error instead of the ack", async () => {
    const fake = fakeSubscriptionConnect();
    const startPromise = subscribeEvents(
      { subscriptions: [SUBSCRIPTION_SPEC], onEvent: () => {} },
      baseDeps(fake.connect),
    );
    await flush();

    fake.sessions[0]?.pushLine(PANE_NOT_FOUND_ERROR_LINE);
    const error = await startPromise.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrRpcError);
    expect((error as HerdrRpcError).code).toBe("pane_not_found");
  });

  it("T3: stop() ends the connection and suppresses any further onEvent", async () => {
    const fake = fakeSubscriptionConnect();
    const events: EventEnvelope[] = [];
    const startPromise = subscribeEvents(
      { subscriptions: [SUBSCRIPTION_SPEC], onEvent: (e) => events.push(e) },
      baseDeps(fake.connect),
    );
    await flush();
    fake.sessions[0]?.pushLine(SUBSCRIPTION_ACK_LINE);
    const handle = await startPromise;

    handle.stop();

    expect(fake.sessions[0]?.ended).toBe(true);
    fake.sessions[0]?.pushLine(EVENT_LINE_1);
    await flush();
    expect(events.length).toBe(0);
  });
});

interface ScheduledTimer {
  fn: () => void;
  ms: number;
}

/** Deterministic fake clock: records backoff schedules, fires them manually. */
function fakeClock() {
  const scheduled: ScheduledTimer[] = [];
  const setTimeoutFn = (fn: () => void, ms: number) => {
    const entry: ScheduledTimer = { fn, ms };
    scheduled.push(entry);
    return entry;
  };
  const clearTimeoutFn = (handle: unknown) => {
    const index = scheduled.indexOf(handle as ScheduledTimer);
    if (index >= 0) scheduled.splice(index, 1);
  };
  const fireNext = async () => {
    const entry = scheduled.shift();
    entry?.fn();
    await flush();
  };
  return { scheduled, setTimeoutFn, clearTimeoutFn, fireNext };
}

describe("herdr subscribe: SubscriptionReconnect", () => {
  it("T1: backs off exponentially from 1s and caps the schedule at 30s", async () => {
    const fake = fakeSubscriptionConnect();
    const clock = fakeClock();
    const startPromise = subscribeEvents(
      { subscriptions: [SUBSCRIPTION_SPEC], onEvent: () => {}, onError: () => {} },
      baseDeps(fake.connect, {
        setTimeoutFn: clock.setTimeoutFn,
        clearTimeoutFn: clock.clearTimeoutFn,
      }),
    );
    await flush();
    fake.sessions[0]?.pushLine(SUBSCRIPTION_ACK_LINE);
    await startPromise;

    fake.sessions[0]?.close();
    expect(clock.scheduled[0]?.ms).toBe(1000);

    fake.failNext(10);
    await clock.fireNext();
    expect(clock.scheduled[0]?.ms).toBe(2000);
    await clock.fireNext();
    expect(clock.scheduled[0]?.ms).toBe(4000);
    await clock.fireNext();
    expect(clock.scheduled[0]?.ms).toBe(8000);
    await clock.fireNext();
    expect(clock.scheduled[0]?.ms).toBe(16000);
    await clock.fireNext();
    expect(clock.scheduled[0]?.ms).toBe(30000);
    await clock.fireNext();
    expect(clock.scheduled[0]?.ms).toBe(30000);
  });

  it("T2: successful re-subscribe resyncs from session.snapshot and resets backoff", async () => {
    const fake = fakeSubscriptionConnect();
    const clock = fakeClock();
    const resyncs: SessionSnapshot[] = [];
    let snapshotFetches = 0;
    const startPromise = subscribeEvents(
      {
        subscriptions: [SUBSCRIPTION_SPEC],
        onEvent: () => {},
        onResync: (snapshot) => resyncs.push(snapshot),
        onError: () => {},
      },
      baseDeps(fake.connect, {
        fetchSnapshot: async () => {
          snapshotFetches += 1;
          return parsedSnapshotFixture();
        },
        setTimeoutFn: clock.setTimeoutFn,
        clearTimeoutFn: clock.clearTimeoutFn,
      }),
    );
    await flush();
    fake.sessions[0]?.pushLine(SUBSCRIPTION_ACK_LINE);
    await startPromise;
    expect(snapshotFetches).toBe(0);

    fake.sessions[0]?.close();
    await clock.fireNext();
    fake.sessions[1]?.pushLine(SUBSCRIPTION_ACK_LINE);
    await flush();

    expect(snapshotFetches).toBe(1);
    expect(resyncs.length).toBe(1);
    expect(resyncs[0]?.protocol).toBe(17);

    fake.sessions[1]?.close();
    expect(clock.scheduled[0]?.ms).toBe(1000);
  });

  it("T3: stop() while a backoff timer is pending cancels all further connect attempts", async () => {
    const fake = fakeSubscriptionConnect();
    const clock = fakeClock();
    const startPromise = subscribeEvents(
      { subscriptions: [SUBSCRIPTION_SPEC], onEvent: () => {}, onError: () => {} },
      baseDeps(fake.connect, {
        setTimeoutFn: clock.setTimeoutFn,
        clearTimeoutFn: clock.clearTimeoutFn,
      }),
    );
    await flush();
    fake.sessions[0]?.pushLine(SUBSCRIPTION_ACK_LINE);
    const handle = await startPromise;

    fake.sessions[0]?.close();
    expect(clock.scheduled.length).toBe(1);

    handle.stop();

    expect(clock.scheduled.length).toBe(0);
    await flush();
    expect(fake.attempts()).toBe(1);
  });
});
