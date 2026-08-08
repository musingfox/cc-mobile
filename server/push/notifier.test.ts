/**
 * The scope gate. Rewritten when the rule changed from "panes cc-mobile
 * launched" to "panes the phone spoke into last" — the old rule was silent on
 * a real machine, where panes are mostly started in a terminal.
 */

import { describe, expect, test } from "bun:test";
import { createPushNotifier, type PushScope } from "./notifier";
import { createPhoneDrivenTracker, type PhoneDrivenTracker } from "./phone-driven";

const SUB = { endpoint: "https://web.push.apple.com/x", keys: {} } as never;

function build(
  opts: { scope?: PushScope; phoneDriven?: PhoneDrivenTracker; subs?: unknown[] } = {},
) {
  const kinds: string[] = [];
  const notifier = createPushNotifier({
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.phoneDriven ? { phoneDriven: opts.phoneDriven } : {}),
    dispatch: async (kind) => {
      kinds.push(kind);
      return { attempted: 1 };
    },
    getSubscriptions: () => (opts.subs ?? [SUB]) as never[],
    warn: () => {},
  });
  return { notifier, kinds };
}

describe("push scope: phone-last", () => {
  test("a turn the phone asked for is announced", async () => {
    const phoneDriven = createPhoneDrivenTracker();
    phoneDriven.markSent("p1");
    phoneDriven.onTurnStart("p1");

    const { notifier, kinds } = build({ phoneDriven });
    await notifier.onTurnSettled("p1");

    expect(kinds).toEqual(["turn"]);
  });

  test("a turn typed at the terminal is not", async () => {
    const phoneDriven = createPhoneDrivenTracker();
    phoneDriven.onTurnStart("p1"); // no send from here preceded it

    const { notifier, kinds } = build({ phoneDriven });
    await notifier.onTurnSettled("p1");

    expect(kinds).toEqual([]);
  });

  test("a permission prompt inherits the turn's verdict", async () => {
    // The prompt is raised inside the turn, so a question that came out of
    // something asked from the phone is asked of the phone.
    const phoneDriven = createPhoneDrivenTracker();
    phoneDriven.markSent("p1");
    phoneDriven.onTurnStart("p1");

    const { notifier, kinds } = build({ phoneDriven });
    await notifier.onPermissionPrompt("p1");

    expect(kinds).toEqual(["permission"]);
  });

  test("a permission prompt on a terminal-driven pane stays quiet", async () => {
    const phoneDriven = createPhoneDrivenTracker();
    phoneDriven.onTurnStart("p1");

    const { notifier, kinds } = build({ phoneDriven });
    await notifier.onPermissionPrompt("p1");

    expect(kinds).toEqual([]);
  });

  test("panes are judged one at a time", async () => {
    const phoneDriven = createPhoneDrivenTracker();
    phoneDriven.markSent("p1");
    phoneDriven.onTurnStart("p1");
    phoneDriven.onTurnStart("p2");

    const { notifier, kinds } = build({ phoneDriven });
    await notifier.onTurnSettled("p1");
    await notifier.onTurnSettled("p2");

    expect(kinds).toEqual(["turn"]);
  });

  test("with no tracker wired nothing is sent, and it says so", async () => {
    // The failure this catches is the one that looks like success: a scope
    // gate that answers "no" forever is indistinguishable from a quiet machine.
    const warnings: string[] = [];
    const notifier = createPushNotifier({
      dispatch: async () => ({ attempted: 1 }),
      getSubscriptions: () => [SUB] as never[],
      warn: (m) => warnings.push(m),
    });

    await notifier.onTurnSettled("p1");
    await notifier.onTurnSettled("p1");

    expect(warnings.length).toBe(1); // once per process, not once per turn
    expect(warnings[0]).toContain("wiring bug");
  });
});

describe("push scope: all", () => {
  test("a pane the phone never touched is announced", async () => {
    const { notifier, kinds } = build({ scope: "all", phoneDriven: createPhoneDrivenTracker() });

    await notifier.onTurnSettled("p1");

    expect(kinds).toEqual(["turn"]);
  });

  test("no tracker is needed at all", async () => {
    const { notifier, kinds } = build({ scope: "all" });

    await notifier.onTurnSettled("p1");

    expect(kinds).toEqual(["turn"]);
  });
});

describe("push scope: subscribers", () => {
  test("no subscribers means no scope work and no send", async () => {
    // Checked before the scope rule on purpose: a machine nobody subscribed
    // from must do nothing at all on every settled turn of every pane.
    const phoneDriven = createPhoneDrivenTracker();
    phoneDriven.markSent("p1");
    phoneDriven.onTurnStart("p1");

    const { notifier, kinds } = build({ phoneDriven, subs: [] });
    await notifier.onTurnSettled("p1");

    expect(kinds).toEqual([]);
  });
});
