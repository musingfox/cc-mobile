/**
 * PaneEventStatusForwarding + PaneEventIdentityChange.
 *
 * Event payloads are verbatim wire shapes from the 2026-08-02 probe, including
 * the naming inconsistency the daemon actually has: `pane_updated` nests the
 * pane under `data.pane`, `pane.agent_status_changed` puts its fields directly
 * on `data`.
 */

import { describe, expect, test } from "bun:test";
import { createTranscriptDelivery } from "../transcript/delivery";
import { createHerdrPaneEvents, type PaneEventTranscript } from "./pane-events";
import type { SubscribeEventsOptions, SubscriptionHandle } from "./subscribe";

const VALUE_A = "a21273d4-77e6-43dc-b9cb-3647561d1192";
const VALUE_B = "3d42f103-8c1e-4a2b-9d55-6f7788990011";

function harness(
  overrides: {
    getSink?: (sessionId: string) => ((msg: Record<string, unknown>) => void) | undefined;
    transcript?: Partial<PaneEventTranscript>;
    snapshot?: () => Promise<{
      panes?: Record<string, unknown>[];
      agents?: Record<string, unknown>[];
    }>;
    subscribeFails?: boolean;
    hasClients?: () => boolean;
    hasPushSubscribers?: () => boolean;
    onTurnSettled?: (sessionId: string) => void | Promise<void>;
  } = {},
) {
  const sent: Record<string, Record<string, unknown>[]> = {};
  const transcriptCalls: string[] = [];
  const errors: Error[] = [];
  /** Every status the permission side was told about, with the kind it got. */
  const permissionCalls: { sessionId: string; status: string; kind?: string }[] = [];
  let emit: ((event: { event: string; data: unknown }) => void) | undefined;
  let resync: ((snapshot: unknown) => void) | undefined;
  const subscriptions: unknown[] = [];
  let stopCalls = 0;

  // Injected clock: the status poll is armed with setIntervalFn, so a test
  // drives it by hand rather than by waiting a real second.
  const ticks = new Map<number, () => void>();
  let nextTimer = 1;

  const transcript: PaneEventTranscript = {
    attach: (id) => {
      transcriptCalls.push(`attach:${id}`);
    },
    resetCursor: (id) => {
      transcriptCalls.push(`reset:${id}`);
    },
    onStatus: (id, status) => {
      transcriptCalls.push(`status:${id}:${status}`);
    },
    deliverTurn: (id) => {
      transcriptCalls.push(`deliver:${id}`);
    },
    ...overrides.transcript,
  };

  const events = createHerdrPaneEvents({
    subscribe: async (options: SubscribeEventsOptions): Promise<SubscriptionHandle> => {
      subscriptions.push(options.subscriptions);
      if (overrides.subscribeFails) throw new Error("stream down");
      emit = options.onEvent as (event: { event: string; data: unknown }) => void;
      resync = options.onResync as (snapshot: unknown) => void;
      return {
        stop: () => {
          stopCalls += 1;
        },
      };
    },
    getSink:
      overrides.getSink ??
      ((sessionId: string) => (msg: Record<string, unknown>) => {
        const messages = sent[sessionId] ?? [];
        messages.push(msg);
        sent[sessionId] = messages;
      }),
    ...(overrides.snapshot ? { snapshot: overrides.snapshot } : {}),
    ...(overrides.hasClients ? { hasClients: overrides.hasClients } : {}),
    ...(overrides.hasPushSubscribers ? { hasPushSubscribers: overrides.hasPushSubscribers } : {}),
    ...(overrides.onTurnSettled ? { onTurnSettled: overrides.onTurnSettled } : {}),
    setIntervalFn: (fn: () => void) => {
      const id = nextTimer++;
      ticks.set(id, fn);
      return id;
    },
    clearIntervalFn: (handle: unknown) => {
      ticks.delete(handle as number);
    },
    transcript,
    permission: {
      onStatus: (sessionId: string, status: string, kind?: string) => {
        permissionCalls.push({ sessionId, status, kind });
      },
    },
    onError: (error: Error) => {
      errors.push(error);
    },
  });

  return {
    events,
    sent,
    errors,
    transcriptCalls,
    permissionCalls,
    subscriptions,
    stopCalls: () => stopCalls,
    timerCount: () => ticks.size,
    emit: (event: { event: string; data: unknown }) => emit?.(event),
    resync: (snapshot: unknown) => resync?.(snapshot),
    /** One poll interval, plus the microtasks the snapshot and its handlers use. */
    tick: async () => {
      for (const fn of [...ticks.values()]) fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/** Lets the fire-and-forget transcript calls settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PaneEventStatusForwarding", () => {
  test("subscribes once, globally, with no pane id", async () => {
    const h = harness();
    await h.events.start();
    await h.events.start();

    // A per-pane filter cannot see a pane cc-mobile never launched.
    expect(h.subscriptions).toEqual([[{ type: "pane.updated" }]]);
  });

  test("forwards a blocked pane from the nested pane_updated shape", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { type: "pane_updated", pane: { pane_id: "w3V:p1", agent_status: "blocked" } },
    });

    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "requires_action" },
    ]);
  });

  test("forwards the dotted agent_status_changed shape, whose fields sit on data", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane.agent_status_changed",
      data: { pane_id: "w3V:p1", agent_status: "working" },
    });

    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "running" },
    ]);
  });

  test("end of turn reads as idle to the UI", async () => {
    const h = harness();
    await h.events.start();

    h.emit({ event: "pane_updated", data: { pane: { pane_id: "w3V:p1", agent_status: "done" } } });

    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "idle" },
    ]);
  });

  test("says nothing at all about a status it does not recognise", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w3V:p1", agent_status: "hibernating" } },
    });

    expect(h.sent["w3V:p1"]).toBeUndefined();
  });

  test("routes each pane's status to its own session only", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w3V:p1", agent_status: "working" } },
    });
    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w9:p1", agent_status: "blocked" } },
    });

    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "running" },
    ]);
    expect(h.sent["w9:p1"]).toEqual([
      { type: "session_state", sessionId: "w9:p1", state: "requires_action" },
    ]);
  });

  test("delivers the turn when a session settles, and arms the tail while it works", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w3V:p1", agent_status: "working" } },
    });
    h.emit({ event: "pane_updated", data: { pane: { pane_id: "w3V:p1", agent_status: "done" } } });
    await flush();

    expect(h.transcriptCalls).toEqual([
      "status:w3V:p1:working",
      "status:w3V:p1:done",
      "deliver:w3V:p1",
    ]);
  });

  test("one settled status replacing another is not a turn ending", async () => {
    const h = harness();
    await h.events.start();

    // First sighting still reads the turn out (a watcher can start mid-turn);
    // the `done -> idle` that follows every turn must not read anything.
    h.emit({ event: "pane_updated", data: { pane: { pane_id: "w3V:p1", agent_status: "done" } } });
    h.emit({ event: "pane_updated", data: { pane: { pane_id: "w3V:p1", agent_status: "idle" } } });
    await flush();

    expect(h.transcriptCalls.filter((call) => call.startsWith("deliver"))).toEqual([
      "deliver:w3V:p1",
    ]);
  });

  test("re-aligns from a fresh snapshot after the stream reconnects", async () => {
    const h = harness();
    await h.events.start();

    h.resync({ panes: [{ pane_id: "w3V:p1", agent_status: "working" }] });

    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "running" },
    ]);
  });
});

/**
 * The status poll. herdr emits a pure status change only on
 * `pane.agent_status_changed`, which cannot be subscribed to without a pane id,
 * so `pane.updated` reports a status only by accident (a title change carrying
 * the pane record). These are the cases where the stream says nothing.
 */
describe("PaneEventStatusPoll", () => {
  test("delivers a turn that settles with no event on the stream at all", async () => {
    let status = "working";
    const h = harness({
      snapshot: async () => ({ panes: [{ pane_id: "w3V:p1", agent_status: status }] }),
    });
    await h.events.start();

    await h.tick();
    status = "done";
    await h.tick();

    expect(h.transcriptCalls).toEqual([
      "status:w3V:p1:working",
      "status:w3V:p1:done",
      "deliver:w3V:p1",
    ]);
    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "running" },
      { type: "session_state", sessionId: "w3V:p1", state: "idle" },
    ]);
  });

  test("repeats nothing the stream already reported", async () => {
    const h = harness({
      snapshot: async () => ({ panes: [{ pane_id: "w3V:p1", agent_status: "working" }] }),
    });
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w3V:p1", agent_status: "working" } },
    });
    await h.tick();
    await h.tick();

    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "running" },
    ]);
  });

  test("still reports status when the stream never opened", async () => {
    const h = harness({
      subscribeFails: true,
      snapshot: async () => ({ panes: [{ pane_id: "w3V:p1", agent_status: "blocked" }] }),
    });
    await h.events.start();
    await h.tick();

    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "requires_action" },
    ]);
  });

  test("a snapshot outage warns once, then recovers on its own", async () => {
    let failing = true;
    const h = harness({
      snapshot: async () => {
        if (failing) throw new Error("daemon gone");
        return { panes: [{ pane_id: "w3V:p1", agent_status: "idle" }] };
      },
    });
    await h.events.start();

    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.errors).toHaveLength(1);

    failing = false;
    // An outage leaves nothing known to be running, so the retry comes at the
    // backed-off rate rather than every second — it still comes.
    for (let i = 0; i < 5; i++) await h.tick();
    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "idle" },
    ]);
  });

  test("stop leaves no poll behind", async () => {
    const h = harness({
      snapshot: async () => ({ panes: [{ pane_id: "w3V:p1", agent_status: "working" }] }),
    });
    await h.events.start();
    expect(h.timerCount()).toBe(1);

    h.events.stop();
    await h.tick();

    expect(h.timerCount()).toBe(0);
    expect(h.sent["w3V:p1"]).toBeUndefined();
  });

  test("no snapshot source arms no poll", async () => {
    const h = harness();
    await h.events.start();

    expect(h.timerCount()).toBe(0);
  });
});

/**
 * A turn shorter than the sampling window. The status the poll sees is the same
 * one it saw last time (or the settled status that follows it), so status alone
 * says "nothing happened" — the daemon's `state_change_seq`, carried on the
 * snapshot's `agents` rows, is what proves otherwise.
 */
describe("PaneEventShortTurn", () => {
  const snapshotOf = (status: string, seq: number) => async () => ({
    panes: [{ pane_id: "w3V:p1", agent_status: status }],
    agents: [{ pane_id: "w3V:p1", agent_status: status, state_change_seq: seq }],
  });

  test("a turn that starts and finishes between two ticks is still read out", async () => {
    let snapshot = snapshotOf("idle", 40);
    const h = harness({ snapshot: () => snapshot() });
    await h.events.start();
    await h.tick();

    // idle -> working -> idle happened entirely inside one interval.
    snapshot = snapshotOf("idle", 42);
    await h.tick();

    expect(h.transcriptCalls.filter((call) => call.startsWith("deliver"))).toEqual([
      "deliver:w3V:p1", // first sighting
      "deliver:w3V:p1", // the turn nobody saw start
    ]);
  });

  test("the same short turn landing on `done` is read out too", async () => {
    let snapshot = snapshotOf("idle", 40);
    const h = harness({ snapshot: () => snapshot() });
    await h.events.start();
    await h.tick();

    snapshot = snapshotOf("done", 42);
    await h.tick();

    expect(h.transcriptCalls.filter((call) => call.startsWith("deliver"))).toHaveLength(2);
    // `done` reads as idle to the UI too, so the phone sees no state flip — the
    // reply arriving is the only visible difference.
    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "idle" },
      { type: "session_state", sessionId: "w3V:p1", state: "idle" },
    ]);
  });

  test("a session sitting still is read out once and never again", async () => {
    const h = harness({ snapshot: snapshotOf("idle", 40) });
    await h.events.start();

    await h.tick();
    await h.tick();
    await h.tick();

    expect(h.transcriptCalls.filter((call) => call.startsWith("deliver"))).toHaveLength(1);
  });

  test("the `done` -> `idle` decay is still not a turn, counter or no counter", async () => {
    let snapshot = snapshotOf("done", 40);
    const h = harness({ snapshot: () => snapshot() });
    await h.events.start();
    await h.tick();

    snapshot = snapshotOf("idle", 41);
    await h.tick();

    expect(h.transcriptCalls.filter((call) => call.startsWith("deliver"))).toHaveLength(1);
  });
});

/**
 * What the poll costs when nothing is waiting on it. Every snapshot is one unix
 * connection to the daemon (transport.ts: one per RPC), so the tiers below are
 * the difference between ~86 400 connections a day and a few thousand.
 */
describe("PaneEventPollBackOff", () => {
  function counted(panes: Record<string, unknown>[], agents: Record<string, unknown>[] = []) {
    const calls = { count: 0 };
    return {
      calls,
      snapshot: async () => {
        calls.count += 1;
        return { panes, agents };
      },
    };
  }

  const livePane = [{ pane_id: "w3V:p1", agent: "claude", agent_status: "idle" }];
  const liveAgent = [
    { pane_id: "w3V:p1", agent: "claude", agent_status: "idle", state_change_seq: 40 },
  ];

  test("asks every second while a phone is watching a running claude", async () => {
    const { calls, snapshot } = counted(livePane, liveAgent);
    const h = harness({ snapshot, hasClients: () => true });
    await h.events.start();

    await h.tick();
    await h.tick();
    await h.tick();

    expect(calls.count).toBe(3);
  });

  test("goes quiet when no phone is connected", async () => {
    const { calls, snapshot } = counted(livePane, liveAgent);
    const h = harness({ snapshot, hasClients: () => false });
    await h.events.start();

    for (let i = 0; i < 10; i++) await h.tick();

    // Dormant tier (30) means first snapshot on the 30th tick; 10 ticks yields 0.
    expect(calls.count).toBe(0);
  });

  test("a pane event does not wake the poll for a phone that is not there", async () => {
    const { calls, snapshot } = counted(livePane, liveAgent);
    const h = harness({ snapshot, hasClients: () => false });
    await h.events.start();
    await h.tick();

    // A working claude retitles its pane constantly; nobody is listening.
    // Dormant: first 29 ticks produce no snapshot.
    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w3V:p1", agent_status: "working" } },
    });
    await h.tick();
    await h.tick();

    expect(calls.count).toBe(0);
  });

  test("the phone coming back gets the turn it missed, in one look", async () => {
    let connected = false;
    let agents = [
      { pane_id: "w3V:p1", agent: "claude", agent_status: "idle", state_change_seq: 40 },
    ];
    const calls = { count: 0 };
    const h = harness({
      hasClients: () => connected,
      snapshot: async () => {
        calls.count += 1;
        return { panes: [{ pane_id: "w3V:p1", agent: "claude", agent_status: "idle" }], agents };
      },
    });
    await h.events.start();
    await h.tick();

    // Two turns run in the user's own terminal while the phone is closed.
    // Dormant: no snapshot call in first ~29 ticks.
    agents = [{ pane_id: "w3V:p1", agent: "claude", agent_status: "idle", state_change_seq: 44 }];
    await h.tick();
    await h.tick();
    expect(calls.count).toBe(0);

    connected = true;
    // resync sets clR without counting as a poll call; then 1 tick fires (every=1)
    h.resync({
      panes: [{ pane_id: "w3V:p1", agent: "claude", agent_status: "idle" }],
      agents: [{ pane_id: "w3V:p1", agent: "claude", agent_status: "idle", state_change_seq: 44 }],
    });
    await h.tick();

    expect(calls.count).toBe(1);
    expect(h.transcriptCalls.filter((call) => call.startsWith("deliver"))).toEqual([
      "deliver:w3V:p1",
    ]);
  });

  test("with a phone but no claude anywhere, an event is what makes it look again", async () => {
    const { calls, snapshot } = counted([{ pane_id: "wS:p1", agent_status: "unknown" }]);
    const h = harness({ snapshot, hasClients: () => true });
    await h.events.start();

    await h.tick();
    await h.tick();
    await h.tick();
    expect(calls.count).toBe(1);

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "wS:p1", agent: "claude", agent_status: "working" } },
    });
    await h.tick();

    expect(calls.count).toBe(2);
  });
});

/**
 * PushSubscriberPollTier contract:
 * With no phone connected but a push registration on file, pane status is polled
 * every ~3 s instead of every 30 s.
 */
describe("PushSubscriberPollTier", () => {
  function counted(panes: Record<string, unknown>[], agents: Record<string, unknown>[] = []) {
    const calls = { count: 0 };
    return {
      calls,
      snapshot: async () => {
        calls.count += 1;
        return { panes, agents };
      },
    };
  }

  const livePane = [{ pane_id: "w3V:p1", agent: "claude", agent_status: "idle" }];
  const liveAgent = [
    { pane_id: "w3V:p1", agent: "claude", agent_status: "idle", state_change_seq: 40 },
  ];

  test("T1: given 3 ticks with hasClients:false, hasPushSubscribers:true -> expect snapshot called exactly 1 time (on the 3rd tick)", async () => {
    const { calls, snapshot } = counted(livePane, liveAgent);
    const h = harness({ snapshot, hasClients: () => false, hasPushSubscribers: () => true });
    await h.events.start();

    await h.tick();
    await h.tick();
    await h.tick();

    expect(calls.count).toBe(1);
  });

  test("T2: given 29 ticks with hasClients:false, hasPushSubscribers:false -> expect snapshot called 0 times", async () => {
    const { calls, snapshot } = counted(livePane, liveAgent);
    const h = harness({ snapshot, hasClients: () => false, hasPushSubscribers: () => false });
    await h.events.start();

    for (let i = 0; i < 29; i++) await h.tick();

    expect(calls.count).toBe(0);
  });

  test("T3: given 1 tick with hasClients:true, claude running, hasPushSubscribers:true -> expect snapshot called 1 time (existing behaviour unchanged)", async () => {
    const { calls, snapshot } = counted(livePane, liveAgent);
    const h = harness({ snapshot, hasClients: () => true, hasPushSubscribers: () => true });
    await h.events.start();

    await h.tick();

    expect(calls.count).toBe(1);
  });

  test("T4: given a stream event setting dueNext, then 1 tick, with hasClients:false and hasPushSubscribers:true -> expect snapshot NOT called on that tick (the shortcut stays gated on hasClients())", async () => {
    const { calls, snapshot } = counted(livePane, liveAgent);
    const h = harness({ snapshot, hasClients: () => false, hasPushSubscribers: () => true });
    await h.events.start();

    await h.tick(); // tick 1: 1 < 3, no call

    // stream event sets dueNext
    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w3V:p1", agent_status: "working" } },
    });
    await h.tick(); // tick 2: 2 < 3 but shortcut=false (no clients), no call

    // dueNext did not trigger because shortcut gated on hasClients()
    expect(calls.count).toBe(0);
  });

  test("T5: given hasPushSubscribers option omitted entirely, 29 ticks with hasClients:false -> expect snapshot called 0 times (today's dormant behaviour)", async () => {
    const { calls, snapshot } = counted(livePane, liveAgent);
    const h = harness({ snapshot, hasClients: () => false });
    await h.events.start();

    for (let i = 0; i < 29; i++) await h.tick();

    expect(calls.count).toBe(0);
  });
});

/**
 * PushTurnSettledTrigger contract:
 * The server announces a finished turn even when no phone is connected,
 * instead of only telling an attached socket.
 */
describe("PushTurnSettledTrigger", () => {
  test("T1: given a pane observed working -> idle with getSink returning undefined -> expect onTurnSettled called exactly once", async () => {
    const settled: string[] = [];
    const h = harness({
      getSink: () => undefined,
      onTurnSettled: (id) => {
        settled.push(id);
      },
    });
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w3V:p1", agent_status: "working" } },
    });
    h.emit({ event: "pane_updated", data: { pane: { pane_id: "w3V:p1", agent_status: "idle" } } });
    await flush();

    expect(settled).toEqual(["w3V:p1"]);
  });

  test("T2: given a pane observed idle -> idle with state_change_seq advancing 4->5 -> expect onTurnSettled called exactly once", async () => {
    let seq = 4;
    const settled: string[] = [];
    const h = harness({
      getSink: () => undefined,
      snapshot: async () => ({
        panes: [{ pane_id: "w3V:p1", agent_status: "idle" }],
        agents: [{ pane_id: "w3V:p1", agent_status: "idle", state_change_seq: seq }],
      }),
      onTurnSettled: (id) => {
        settled.push(id);
      },
    });
    await h.events.start();
    await h.tick(); // first sighting idle seq4 (calls once, ignore for adv test)
    settled.length = 0;

    seq = 5;
    await h.tick(); // same status, seq adv -> onTurnSettled exactly once

    expect(settled).toEqual(["w3V:p1"]);
  });

  test("T3: given a pane observed done -> idle (the decaying pair) -> expect onTurnSettled not called", async () => {
    const settled: string[] = [];
    const h = harness({
      getSink: () => undefined,
      onTurnSettled: (id) => {
        settled.push(id);
      },
    });
    await h.events.start();

    h.emit({ event: "pane_updated", data: { pane: { pane_id: "w3V:p1", agent_status: "done" } } });
    settled.length = 0; // ignore the done arrival itself
    h.emit({ event: "pane_updated", data: { pane: { pane_id: "w3V:p1", agent_status: "idle" } } });
    await flush();

    expect(settled).toEqual([]);
  });

  test("T4: given a collaborator whose onTurnSettled rejects -> expect the error reaches onError and session_state handling for that pane still completes", async () => {
    const sent: Record<string, unknown>[] = [];
    const h = harness({
      getSink: () => (m) => sent.push(m),
      onTurnSettled: () => Promise.reject(new Error("onTurnSettled failed")),
    });
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w3V:p1", agent_status: "working" } },
    });
    h.emit({ event: "pane_updated", data: { pane: { pane_id: "w3V:p1", agent_status: "idle" } } });
    await flush();

    expect(h.errors.some((e) => e.message.includes("onTurnSettled failed"))).toBe(true);
    // session_state still sent despite reject
    expect(
      sent.some(
        (m) =>
          (m as Record<string, unknown>).type === "session_state" &&
          (m as Record<string, unknown>).state === "idle",
      ),
    ).toBe(true);
  });
});

describe("PaneEventIdentityChange", () => {
  test("resets the transcript cursor when the conversation rotates", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: {
        pane: {
          pane_id: "w3V:p1",
          agent_status: "idle",
          agent_session: { kind: "id", value: VALUE_A },
        },
      },
    });
    h.emit({
      event: "pane_updated",
      data: {
        pane: {
          pane_id: "w3V:p1",
          agent_status: "idle",
          agent_session: { kind: "id", value: VALUE_B },
        },
      },
    });
    await flush();

    // First sighting takes a cursor at EOF; the /clear takes a new one at the
    // new file's EOF instead of tailing a dead transcript.
    expect(h.transcriptCalls.filter((call) => call.startsWith("attach"))).toEqual([
      "attach:w3V:p1",
    ]);
    expect(h.transcriptCalls.filter((call) => call.startsWith("reset"))).toEqual(["reset:w3V:p1"]);
  });

  test("leaves the cursor alone when the same session id is re-reported", async () => {
    const h = harness();
    await h.events.start();

    for (const status of ["working", "done"]) {
      h.emit({
        event: "pane_updated",
        data: {
          pane: { pane_id: "w3V:p1", agent_status: status, agent_session: { value: VALUE_A } },
        },
      });
    }
    await flush();

    expect(h.transcriptCalls.filter((call) => call.startsWith("reset"))).toEqual([]);
  });

  test("treats an absent agent_session as no claim, not as a rotation to null", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: {
        pane: { pane_id: "w3V:p1", agent_status: "idle", agent_session: { value: VALUE_A } },
      },
    });
    h.emit({
      event: "pane.agent_status_changed",
      data: { pane_id: "w3V:p1", agent_status: "working" },
    });
    await flush();

    expect(h.transcriptCalls.filter((call) => call.startsWith("reset"))).toEqual([]);
  });

  test("takes a cursor at end of file for a pane it has never seen, emitting nothing", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "wNew:p1", agent_session: { value: VALUE_A } } },
    });
    await flush();

    expect(h.transcriptCalls).toEqual(["attach:wNew:p1"]);
    expect(h.sent["wNew:p1"]).toBeUndefined();
  });

  test("a forgotten pane id starts clean if the daemon reuses it", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: {
        pane: { pane_id: "w3V:p1", agent_status: "idle", agent_session: { value: VALUE_A } },
      },
    });
    h.events.forget("w3V:p1");
    h.emit({
      event: "pane_updated",
      data: {
        pane: { pane_id: "w3V:p1", agent_status: "idle", agent_session: { value: VALUE_B } },
      },
    });
    await flush();

    expect(h.transcriptCalls.filter((call) => call.startsWith("reset"))).toEqual([]);
    expect(h.transcriptCalls.filter((call) => call.startsWith("attach"))).toEqual([
      "attach:w3V:p1",
      "attach:w3V:p1",
    ]);
  });
});

describe("PaneKindStickyObservation", () => {
  /** The kind reported alongside the `blocked` the permission side saw. */
  function kindAtBlocked(h: ReturnType<typeof harness>) {
    return h.permissionCalls.find((call) => call.status === "blocked")?.kind;
  }

  test("remembers the kind a later partial update leaves out", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w6C:p1", agent: "omp", agent_status: "idle" } },
    });
    // A `pane.agent_status_changed` carries the status and little else; losing
    // the kind here would make this look like a pane herdr never described.
    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w6C:p1", agent_status: "blocked" } },
    });
    await flush();

    expect(kindAtBlocked(h)).toBe("omp");
  });

  test("reports no kind for a pane that never reported one", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w9:p1", agent_status: "blocked" } },
    });
    await flush();

    expect(h.permissionCalls).toHaveLength(1);
    expect(kindAtBlocked(h)).toBeUndefined();
  });

  test("an empty kind is not a report, and is not carried as a kind either", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w9:p1", agent: "", agent_status: "blocked" } },
    });
    await flush();

    expect(kindAtBlocked(h)).toBeUndefined();
  });

  test("a forgotten pane id starts from nothing, kind included", async () => {
    const h = harness();
    await h.events.start();

    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w6C:p1", agent: "omp", agent_status: "idle" } },
    });
    h.events.forget("w6C:p1");
    h.emit({
      event: "pane_updated",
      data: { pane: { pane_id: "w6C:p1", agent_status: "blocked" } },
    });
    await flush();

    // herdr reuses pane ids; carrying the old tenant's kind into a new one
    // would decide the new pane's permission handling on stale evidence.
    expect(kindAtBlocked(h)).toBeUndefined();
  });
});

// ── wired to the real transcript delivery ────────────────────────────────────

describe("pane events driving the real transcript delivery", () => {
  /** A fake transcript whose "bytes" are record counts. */
  function fakeFile() {
    let records: unknown[] = [];
    return {
      append(record: unknown) {
        records = [...records, record];
      },
      get size() {
        return records.length;
      },
      read: async ({ cursor }: { path: string; cursor: { byteOffset: number } }) => ({
        records: records.slice(cursor.byteOffset),
        cursor: { byteOffset: records.length, lastUuid: null },
      }),
    };
  }

  function fakeIntervals() {
    const timers = new Map<number, { fn: () => void; ms: number }>();
    let nextId = 1;
    return {
      setIntervalFn: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearIntervalFn: (handle: unknown) => {
        timers.delete(handle as number);
      },
      get count() {
        return timers.size;
      },
      async advance(ms: number) {
        for (const { fn, ms: period } of [...timers.values()]) {
          for (let elapsed = period; elapsed <= ms; elapsed += period) {
            fn();
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      },
    };
  }

  test("a first event carrying both session and status leaves no timer behind", async () => {
    const file = fakeFile();
    const clock = fakeIntervals();
    const messages: Record<string, unknown>[] = [];
    let resolveCalls = 0;

    const delivery = createTranscriptDelivery({
      resolvePath: async () => {
        resolveCalls++;
        // A real resolve is two RPCs plus a directory scan; the identity and
        // status handlers both arrive while it is still in flight.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "/transcript.jsonl";
      },
      getSink: () => (msg) => messages.push(msg),
      read: file.read,
      initCursor: async () => ({ byteOffset: file.size, lastUuid: null }),
      stat: async () => file.size,
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    const events = createHerdrPaneEvents({
      subscribe: async (options) => {
        emitTo = options.onEvent as (event: { event: string; data: unknown }) => void;
        return { stop: () => {} };
      },
      getSink: () => (msg) => messages.push(msg),
      transcript: {
        attach: (id) => delivery.attach(id),
        resetCursor: (id) => delivery.resetCursor(id),
        onStatus: (id, status) => delivery.onStatus(id, status),
        deliverTurn: (id) => delivery.deliverTurn(id),
      },
      onError: () => {},
    });

    let emitTo: ((event: { event: string; data: unknown }) => void) | undefined;
    await events.start();

    // The verbatim probe shape: one pane_updated carries pane_id, agent_session
    // and agent_status together.
    emitTo?.({
      event: "pane_updated",
      data: {
        type: "pane_updated",
        pane: {
          pane_id: "w3V:p1",
          agent_status: "working",
          agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: VALUE_A },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    file.append({ type: "assistant", message: { role: "assistant", content: [] } });
    emitTo?.({
      event: "pane_updated",
      data: {
        pane: { pane_id: "w3V:p1", agent_status: "done", agent_session: { value: VALUE_A } },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // One state was built, so the tail timer the status handler armed is the one
    // the settle stops. A second state would leave a 1 s stat loop running for
    // the life of the process.
    expect(resolveCalls).toBe(1);
    expect(clock.count).toBe(0);

    const before = messages.length;
    await clock.advance(10_000);
    expect(messages.length).toBe(before);
    expect(messages.filter((msg) => msg.type === "stream_end")).toHaveLength(1);
  });
});
