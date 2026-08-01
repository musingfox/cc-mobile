/**
 * status-events.test.ts — HerdrStatusForwarding.
 *
 * The subscription params assertion is load-bearing: the daemon rejects a
 * type-only filter on pane.agent_status_changed with `invalid_request: missing
 * field pane_id` (live probe), so a subscription missing pane_id never starts.
 */

import { describe, expect, test } from "bun:test";
import { createHerdrStatusEvents } from "./status-events";
import type { SubscribeEventsOptions } from "./subscribe";

function makeHarness(subscribeImpl?: (options: SubscribeEventsOptions) => Promise<never>) {
  const recorded: SubscribeEventsOptions[] = [];
  const stopCalls: number[] = [];
  const sinks = new Map<string, (msg: Record<string, unknown>) => void>();
  const errors: Error[] = [];
  let emit: ((event: { event: string; data: unknown }) => void) | undefined;

  const statusEvents = createHerdrStatusEvents({
    subscribe: async (options) => {
      if (subscribeImpl) return subscribeImpl(options);
      recorded.push(options);
      emit = (event) => options.onEvent(event as never);
      const index = recorded.length - 1;
      return {
        stop: () => stopCalls.push(index),
      };
    },
    getSink: (claudeUuid) => sinks.get(claudeUuid),
    onError: (error) => errors.push(error),
  });

  return {
    statusEvents,
    recorded,
    stopCalls,
    errors,
    registerSink(claudeUuid: string, sink: (msg: Record<string, unknown>) => void) {
      sinks.set(claudeUuid, sink);
    },
    emitStatus(status: string, paneId = "p1") {
      emit?.({
        event: "pane.agent_status_changed",
        data: { agent_status: status, pane_id: paneId },
      });
    },
  };
}

describe("HerdrStatusForwarding", () => {
  test("subscribes with the pane_id the daemon requires", async () => {
    const harness = makeHarness();

    await harness.statusEvents.start("u1", "p1");

    expect(harness.recorded[0]?.subscriptions).toEqual([
      { type: "pane.agent_status_changed", pane_id: "p1" },
    ]);
  });

  test("maps working to running and done to idle", async () => {
    const harness = makeHarness();
    const seen: Record<string, unknown>[] = [];
    harness.registerSink("u1", (msg) => seen.push(msg));
    await harness.statusEvents.start("u1", "p1");

    harness.emitStatus("working");
    harness.emitStatus("done");

    expect(seen).toEqual([
      { type: "session_state", sessionId: "u1", state: "running" },
      { type: "session_state", sessionId: "u1", state: "idle" },
    ]);
  });

  test("maps blocked to requires_action and drops unknown", async () => {
    const harness = makeHarness();
    const seen: Record<string, unknown>[] = [];
    harness.registerSink("u1", (msg) => seen.push(msg));
    await harness.statusEvents.start("u1", "p1");

    harness.emitStatus("blocked");
    harness.emitStatus("unknown");

    expect(seen).toEqual([{ type: "session_state", sessionId: "u1", state: "requires_action" }]);
  });

  test("drops events for a session with no registered sink", async () => {
    const harness = makeHarness();
    await harness.statusEvents.start("u1", "p1");

    expect(() => harness.emitStatus("working")).not.toThrow();
  });

  test("stop closes the subscription", async () => {
    const harness = makeHarness();
    const seen: Record<string, unknown>[] = [];
    harness.registerSink("u1", (msg) => seen.push(msg));
    await harness.statusEvents.start("u1", "p1");

    harness.statusEvents.stop("u1");

    expect(harness.stopCalls).toEqual([0]);
  });

  test("a failed subscription is non-fatal", async () => {
    const boom = new Error("daemon refused");
    const harness = makeHarness(async () => {
      throw boom;
    });

    await expect(harness.statusEvents.start("u1", "p1")).resolves.toBeUndefined();
    expect(harness.errors).toEqual([boom]);
  });

  test("stopAll closes every live subscription", async () => {
    const harness = makeHarness();
    await harness.statusEvents.start("u1", "p1");
    await harness.statusEvents.start("u2", "p2");

    harness.statusEvents.stopAll();

    expect(harness.stopCalls.sort()).toEqual([0, 1]);
  });
});
