/**
 * readiness.test.ts — HerdrReadinessGate.
 *
 * `agent.start` returns in ~1ms with `launch_pending:true` and no subscription
 * event ever carries `interactive_ready`, so polling `agent.get` is the only
 * readiness signal (live probe, 2026-08-01). These cases pin the three
 * behaviours that matter: tolerate the detection lag, give up on budget, and
 * never swallow a real RPC failure.
 */

import { describe, expect, test } from "bun:test";
import { HerdrRpcError } from "./errors";
import { waitForInteractiveReady } from "./readiness";

/** Fake clock whose time only moves when the injected sleep is awaited. */
function makeFakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
    /** Sleep that resolves without advancing time (T1: budget never matters). */
    instantSleep: async () => {},
  };
}

describe("HerdrReadinessGate", () => {
  test("tolerates agent_not_found while detection lags, then resolves on interactive_ready", async () => {
    const clock = makeFakeClock();
    const results: Array<() => Promise<{ interactive_ready?: boolean }>> = [
      async () => {
        throw new HerdrRpcError("agent_not_found", "no agent on pane p1");
      },
      async () => ({ interactive_ready: false }),
      async () => ({ interactive_ready: true }),
    ];
    let calls = 0;
    const agentGet = async () => {
      const next = results[calls];
      calls += 1;
      if (!next) throw new Error("agentGet called more times than the fixture allows");
      return next();
    };

    await waitForInteractiveReady({
      agentGet,
      paneId: "p1",
      sleep: clock.instantSleep,
      now: clock.now,
    });

    expect(calls).toBe(3);
  });

  test("rejects naming interactive_ready and the pane once the budget is exhausted", async () => {
    const clock = makeFakeClock();
    let calls = 0;
    const agentGet = async () => {
      calls += 1;
      return { interactive_ready: false };
    };

    const caught = await waitForInteractiveReady({
      agentGet,
      paneId: "p1",
      budgetMs: 30_000,
      pollMs: 300,
      sleep: clock.sleep,
      now: clock.now,
    })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/interactive_ready/);
    expect((caught as Error).message).toContain("p1");
    // 30000ms budget / 300ms poll — the gate must actually spend the budget.
    expect(calls).toBeGreaterThanOrEqual(100);

    // No stray polling after the rejection.
    const callsAtRejection = calls;
    await clock.sleep(5_000);
    expect(calls).toBe(callsAtRejection);
  });

  test("rejects immediately on any RPC error other than agent_not_found", async () => {
    const clock = makeFakeClock();
    const original = new HerdrRpcError("invalid_request", "missing field pane_id");
    let calls = 0;
    const agentGet = async () => {
      calls += 1;
      throw original;
    };

    const caught = await waitForInteractiveReady({
      agentGet,
      paneId: "p1",
      sleep: clock.sleep,
      now: clock.now,
    })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(caught).toBe(original);
    expect(calls).toBe(1);
  });
});
