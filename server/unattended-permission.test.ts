/**
 * unattended-permission.test.ts — UnattendedDenyForSelfLaunched.
 *
 * The #24 safety contract, re-expressed for the herdr-native model. It used to
 * be a promise the server resolved with `{allow:false}` when a hook had been
 * waiting 90 s; there is no promise any more — claude is blocked on its own
 * screen — so the deny is now an actual keystroke sent into the pane.
 *
 * What that costs, and what it buys, is the whole point of these cases:
 *
 *   EX-A0  no client is listening ⇒ the prompt is still cancelled, and no
 *          approving key is ever sent. `esc` is the ONLY key cc-mobile presses
 *          on its own.
 *   EX-A1  a disconnect freezes the countdown and keeps the pending record;
 *          nothing is answered by the disconnect itself.
 *   EX-A2  89 999 ms pending / 90 000 ms denies — verbatim, for a pane cc-mobile
 *          launched.
 *   EX-C2  the frozen countdown resumes on reconnect, and the prompt is re-read
 *          from the live screen rather than replayed from a stored payload.
 *
 * And the two guards that make an automated keystroke safe at all:
 *   - a foreign pane (one the user opened in their own terminal) is NEVER
 *     auto-answered: somebody is demonstrably at that keyboard (Decision H2).
 *   - the pane's status AND the prompt fingerprint are re-read from the daemon
 *     immediately before the key. herdr reports claude's first-run trust dialog
 *     as `idle`, and `esc` there means "No, exit" — firing on remembered state
 *     would kill the user's claude (probe 2026-08-02).
 *
 * The clock is injected; no test waits on a real timer.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createNativePermission,
  type NativePermissionClient,
  UNATTENDED_DENY_MS,
} from "./herdr/permission/native-permission";

const PANE = "w3V:p1";
const BASH_PROMPT = readFileSync(
  join(import.meta.dir, "herdr", "permission", "fixtures", "blocked-bash-prompt.txt"),
  "utf8",
);
const OTHER_PROMPT = BASH_PROMPT.replaceAll("canary2.txt", "elsewhere.txt");

// ── fake clock ───────────────────────────────────────────────────────────────

function makeFakeClock(startMs = 1_000_000) {
  let current = startMs;
  type Timer = { id: number; fireAt: number; fn: () => void; cleared: boolean };
  const timers: Timer[] = [];
  let nextId = 1;

  return {
    now: () => current,
    setTimeoutFn: (fn: () => void, ms: number) => {
      const timer: Timer = { id: nextId++, fireAt: current + ms, fn, cleared: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeoutFn: (id: unknown) => {
      const timer = timers.find((candidate) => candidate.id === id);
      if (timer) timer.cleared = true;
    },
    /** Advances the clock and lets every keystroke the timers cause complete. */
    async advance(ms: number) {
      current += ms;
      for (const timer of [...timers]) {
        if (timer.cleared || timer.fireAt > current) continue;
        timer.cleared = true;
        timer.fn();
      }
      // The guard's RPCs are already-resolved promises in these fakes, so one
      // macrotask tick drains the whole chain.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

// ── harness ──────────────────────────────────────────────────────────────────

function harness(overrides: { origin?: "self" | "foreign"; sink?: boolean } = {}) {
  const clock = makeFakeClock();
  const keys: { pane: string; keys: string[] }[] = [];
  const sent: Record<string, unknown>[] = [];
  const screen = { text: BASH_PROMPT };
  const status = { value: "blocked" };

  const client: NativePermissionClient = {
    agentGet: async () => ({ agent_status: status.value }),
    paneRead: async () => ({ text: screen.text, revision: 7 }),
    paneSendKeys: async (pane, pressed) => {
      keys.push({ pane, keys: pressed });
    },
  };

  let counter = 0;
  const permission = createNativePermission({
    client,
    getSink: overrides.sink === false ? () => undefined : () => (msg) => sent.push(msg),
    originOf: () => overrides.origin ?? "self",
    newRequestId: () => `r${++counter}`,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    now: clock.now,
    warn: () => {},
  });

  return { permission, clock, keys, sent, screen, status };
}

describe("UnattendedDenyForSelfLaunched", () => {
  it("EX-A2 lower bound: 89 999 ms leaves the prompt pending", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");

    await h.clock.advance(UNATTENDED_DENY_MS - 1);

    expect(h.keys).toEqual([]);
    expect(h.permission.pendingCount()).toBe(1);
  });

  it("EX-A2 upper bound: 90 000 ms cancels the prompt with esc", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");

    await h.clock.advance(UNATTENDED_DENY_MS);

    expect(h.keys).toEqual([{ pane: PANE, keys: ["esc"] }]);
    expect(h.permission.pendingCount()).toBe(0);
  });

  it("EX-A0: with nobody listening it still cancels, and never approves", async () => {
    const h = harness({ sink: false });
    await h.permission.onStatus(PANE, "blocked");

    await h.clock.advance(UNATTENDED_DENY_MS);

    // The only automated keystroke in the system. A digit here would be
    // cc-mobile approving a tool call no human ever saw.
    expect(h.keys).toEqual([{ pane: PANE, keys: ["esc"] }]);
    expect(h.keys.flatMap((entry) => entry.keys)).not.toContain("1");
    expect(h.keys.flatMap((entry) => entry.keys)).not.toContain("Enter");
  });

  it("sends nothing when the pane has left blocked by the time the timer fires", async () => {
    // The destructive case: herdr calls claude's trust dialog `idle`, and `esc`
    // there exits claude.
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");
    h.status.value = "idle";

    await h.clock.advance(UNATTENDED_DENY_MS);

    expect(h.keys).toEqual([]);
  });

  it("sends nothing when a different prompt is now on screen", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");
    h.screen.text = OTHER_PROMPT;

    await h.clock.advance(UNATTENDED_DENY_MS);

    expect(h.keys).toEqual([]);
  });

  it("never auto-answers a session the user opened in their own terminal", async () => {
    const h = harness({ origin: "foreign" });
    await h.permission.onStatus(PANE, "blocked");

    await h.clock.advance(600_000);

    expect(h.keys).toEqual([]);
    expect(h.permission.pendingCount()).toBe(1);
  });

  it("stops the countdown once the user answers", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");

    await h.permission.resolve("r1", { optionId: "3" });
    await h.clock.advance(UNATTENDED_DENY_MS * 2);

    expect(h.keys).toEqual([{ pane: PANE, keys: ["3"] }]);
  });
});

describe("UnattendedDenyForSelfLaunched — across a disconnect", () => {
  it("EX-A1: a disconnect freezes the countdown without answering anything", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");

    await h.clock.advance(30_000);
    h.permission.pause();
    await h.clock.advance(600_000);

    expect(h.keys).toEqual([]);
    expect(h.permission.pendingCount()).toBe(1);
  });

  it("EX-C2: the reconnect re-reads the live prompt and resumes the remaining time", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");
    const first = (h.sent[0] as { requestId: string }).requestId;

    await h.clock.advance(30_000);
    h.permission.pause();
    await h.clock.advance(90_000);
    await h.permission.resume();

    // A fresh request read off the screen, not a replay of the stored payload.
    expect(h.sent).toHaveLength(2);
    const second = h.sent[1] as { requestId: string; type: string };
    expect(second.type).toBe("permission_request");
    expect(second.requestId).not.toBe(first);

    // 30 s was already spent, so 60 s remain — not a fresh 90.
    await h.clock.advance(59_999);
    expect(h.keys).toEqual([]);
    await h.clock.advance(1);
    expect(h.keys).toEqual([{ pane: PANE, keys: ["esc"] }]);
  });

  it("a prompt answered in the terminal during the gap is dropped, not denied", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");

    h.permission.pause();
    h.status.value = "idle";
    await h.permission.resume();
    await h.clock.advance(UNATTENDED_DENY_MS * 2);

    expect(h.keys).toEqual([]);
    expect(h.permission.pendingCount()).toBe(0);
  });
});
