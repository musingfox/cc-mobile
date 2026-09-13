import { describe, expect, test } from "bun:test";
import { createPushNotifier, TURN_PUSH_WINDOW_MS } from "./notifier";
import { createPhoneDrivenTracker } from "./phone-driven";

const SUB = { endpoint: "https://web.push.apple.com/x", keys: {} } as never;
function build(driven = true, subs = [SUB]) {
  let now = 0; let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const kinds: string[] = []; const warnings: string[] = [];
  const tracker = createPhoneDrivenTracker(); if (driven) tracker.markSent("p1");
  const notifier = createPushNotifier({ phoneDriven: tracker, getSubscriptions: () => subs as never[],
    dispatch: async (kind) => { kinds.push(kind); return { attempted: 1 }; }, warn: (m) => warnings.push(m),
    setTimeoutFn: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeoutFn: (id) => { timers.delete(id as number); },
  });
  const advance = async (ms: number) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await Promise.resolve(); };
  return { notifier, kinds, warnings, tracker, advance };
}

describe("status-driven push timing", () => {
  test("blocked dispatches immediately only when in scope", async () => {
    const h = build(); await h.notifier.onAgentStatus("p1", "blocked"); expect(h.kinds).toEqual(["permission"]);
    const quiet = build(false); await quiet.notifier.onAgentStatus("p1", "blocked"); expect(quiet.kinds).toEqual([]);
  });
  test("done waits 45 seconds and captures the scope verdict", async () => {
    const h = build(); await h.notifier.onAgentStatus("p1", "done"); h.tracker.forget("p1");
    await h.advance(TURN_PUSH_WINDOW_MS - 1); expect(h.kinds).toEqual([]); await h.advance(1); expect(h.kinds).toEqual(["turn"]);
  });
  test("new work drops a pending completion", async () => {
    const h = build(); await h.notifier.onAgentStatus("p1", "done"); await h.advance(10_000); await h.notifier.onAgentStatus("p1", "working"); await h.advance(120_000); expect(h.kinds).toEqual([]);
  });
  test("the first expiry merges all pending panes", async () => {
    const h = build(); h.tracker.markSent("p2"); h.tracker.markSent("p3");
    await h.notifier.onAgentStatus("p1", "done"); await h.advance(20_000); await h.notifier.onAgentStatus("p2", "done"); await h.advance(20_000); await h.notifier.onAgentStatus("p3", "done"); await h.advance(6_000);
    expect(h.kinds).toEqual(["turn"]); await h.advance(200_000); expect(h.kinds).toEqual(["turn"]);
  });
  test("forget cancels an armed pane", async () => { const h = build(); await h.notifier.onAgentStatus("p1", "done"); h.notifier.forget("p1"); await h.advance(50_000); expect(h.kinds).toEqual([]); });
});
