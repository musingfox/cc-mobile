/**
 * pty-response-relay.test.ts — Unit tests for createPtyResponseRelay
 *
 * All deterministic: injected setTimeout/clearTimeout, no real timers, no claude.
 * Covers:
 *   1. resolve happy path: awaitResponse resolves with delivered text
 *   2. resolve before await: unknown session → resolveResponse returns false (no-op)
 *   3. timeout: deadline fires → promise rejects with "timeout"
 *   4. resolve clears timer: no reject after a resolve
 *   5. hasPending / getPendingCount reflect state
 *   6. supersede: re-await same session rejects prior waiter, new one resolves
 *   7. per-session isolation: resolving one session doesn't touch another
 */

import { describe, expect, it } from "bun:test";
import { createPtyResponseRelay } from "./pty-response-relay";

/** Manual timer harness: collects scheduled callbacks so tests fire them explicitly. */
function makeTimers() {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    setTimeoutFn: (fn: () => void, _ms: number) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeoutFn: (id: unknown) => {
      timers.delete(id as number);
    },
    fire: (id: number) => {
      const fn = timers.get(id);
      if (fn) {
        timers.delete(id);
        fn();
      }
    },
    fireAll: () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
    count: () => timers.size,
  };
}

describe("createPtyResponseRelay", () => {
  it("resolves awaitResponse with the delivered text", async () => {
    const t = makeTimers();
    const relay = createPtyResponseRelay({
      setTimeoutFn: t.setTimeoutFn,
      clearTimeoutFn: t.clearTimeoutFn,
    });

    const p = relay.awaitResponse("s1");
    const delivered = relay.resolveResponse("s1", "PONG");

    expect(delivered).toBe(true);
    expect(await p).toBe("PONG");
  });

  it("resolveResponse for unknown session is a no-op returning false", () => {
    const relay = createPtyResponseRelay();
    expect(relay.resolveResponse("nope", "x")).toBe(false);
  });

  it("rejects with timeout when the deadline fires", async () => {
    const t = makeTimers();
    const relay = createPtyResponseRelay({
      setTimeoutFn: t.setTimeoutFn,
      clearTimeoutFn: t.clearTimeoutFn,
    });

    const p = relay.awaitResponse("s1");
    t.fireAll(); // fire the timeout

    await expect(p).rejects.toThrow("timeout");
  });

  it("clears the timer on resolve so timeout cannot fire afterward", async () => {
    const t = makeTimers();
    const relay = createPtyResponseRelay({
      setTimeoutFn: t.setTimeoutFn,
      clearTimeoutFn: t.clearTimeoutFn,
    });

    const p = relay.awaitResponse("s1");
    expect(t.count()).toBe(1);
    relay.resolveResponse("s1", "done");
    expect(t.count()).toBe(0); // timer was cleared
    expect(await p).toBe("done");
  });

  it("tracks hasPending and getPendingCount", () => {
    const t = makeTimers();
    const relay = createPtyResponseRelay({
      setTimeoutFn: t.setTimeoutFn,
      clearTimeoutFn: t.clearTimeoutFn,
    });

    expect(relay.hasPending("s1")).toBe(false);
    relay.awaitResponse("s1");
    expect(relay.hasPending("s1")).toBe(true);
    expect(relay.getPendingCount()).toBe(1);
    relay.resolveResponse("s1", "x");
    expect(relay.hasPending("s1")).toBe(false);
    expect(relay.getPendingCount()).toBe(0);
  });

  it("supersedes a prior waiter when the same session re-awaits", async () => {
    const t = makeTimers();
    const relay = createPtyResponseRelay({
      setTimeoutFn: t.setTimeoutFn,
      clearTimeoutFn: t.clearTimeoutFn,
    });

    const first = relay.awaitResponse("s1");
    const second = relay.awaitResponse("s1"); // supersedes first

    await expect(first).rejects.toThrow("superseded");
    relay.resolveResponse("s1", "second-wins");
    expect(await second).toBe("second-wins");
  });

  it("isolates sessions: resolving one leaves the other pending", async () => {
    const t = makeTimers();
    const relay = createPtyResponseRelay({
      setTimeoutFn: t.setTimeoutFn,
      clearTimeoutFn: t.clearTimeoutFn,
    });

    const a = relay.awaitResponse("sa");
    relay.awaitResponse("sb");

    relay.resolveResponse("sa", "A");
    expect(await a).toBe("A");
    expect(relay.hasPending("sb")).toBe(true);
  });

  it("T1: cancel('u1') rejects the waiter with 'cancelled', clears pending, and calls clearTimeout before reject", async () => {
    const t = makeTimers();
    let clearCalled = false;
    const originalClear = t.clearTimeoutFn;
    const relay = createPtyResponseRelay({
      setTimeoutFn: t.setTimeoutFn,
      clearTimeoutFn: (id) => {
        clearCalled = true;
        originalClear(id);
      },
    });

    const p = relay.awaitResponse("u1");
    expect(relay.hasPending("u1")).toBe(true);
    expect(t.count()).toBe(1);

    relay.cancel("u1");

    expect(clearCalled).toBe(true); // clear before reject
    expect(relay.hasPending("u1")).toBe(false);
    await expect(p).rejects.toThrow("cancelled");
  });

  it("T2: cancel('nope') with no waiter does not throw and getPendingCount unchanged", () => {
    const t = makeTimers();
    const relay = createPtyResponseRelay({
      setTimeoutFn: t.setTimeoutFn,
      clearTimeoutFn: t.clearTimeoutFn,
    });

    const initialCount = relay.getPendingCount();
    expect(() => relay.cancel("nope")).not.toThrow();
    expect(relay.getPendingCount()).toBe(initialCount);
  });
});
