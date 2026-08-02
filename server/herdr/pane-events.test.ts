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
  } = {},
) {
  const sent: Record<string, Record<string, unknown>[]> = {};
  const transcriptCalls: string[] = [];
  let emit: ((event: { event: string; data: unknown }) => void) | undefined;
  let resync: ((snapshot: unknown) => void) | undefined;
  const subscriptions: unknown[] = [];
  let stopCalls = 0;

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
    transcript,
    onError: () => {},
  });

  return {
    events,
    sent,
    transcriptCalls,
    subscriptions,
    stopCalls: () => stopCalls,
    emit: (event: { event: string; data: unknown }) => emit?.(event),
    resync: (snapshot: unknown) => resync?.(snapshot),
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

  test("re-aligns from a fresh snapshot after the stream reconnects", async () => {
    const h = harness();
    await h.events.start();

    h.resync({ panes: [{ pane_id: "w3V:p1", agent_status: "working" }] });

    expect(h.sent["w3V:p1"]).toEqual([
      { type: "session_state", sessionId: "w3V:p1", state: "running" },
    ]);
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
