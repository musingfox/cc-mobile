/**
 * The notifier decides *when* a pane may buzz a phone and *which* panes may.
 * Both halves are tested here against an injected tracker and injected timers:
 * a real 45-second `setTimeout` would keep the whole suite alive, and the real
 * tracker's verdict is the thing being asserted, not the thing being trusted.
 */

import { describe, expect, test } from "bun:test";
import { createPushNotifier, TURN_PUSH_WINDOW_MS } from "./notifier";
import { createPhoneDrivenTracker } from "./phone-driven";

const SUB = { endpoint: "https://web.push.apple.com/x", keys: {} } as never;

function build(
  options: {
    driven?: boolean;
    subs?: unknown[];
    scope?: "phone-last" | "all";
    tracker?: boolean;
    cwdOf?: (paneId: string) => Promise<string | null>;
    isHangarPane?: (paneKey: string) => boolean;
  } = {},
) {
  const {
    driven = true,
    subs = [SUB],
    scope,
    tracker: withTracker = true,
    cwdOf,
    isHangarPane,
  } = options;

  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const kinds: string[] = [];
  const abouts: unknown[] = [];
  const warnings: string[] = [];

  const tracker = createPhoneDrivenTracker();
  if (driven) tracker.markSent("p1");

  const notifier = createPushNotifier({
    ...(withTracker ? { phoneDriven: tracker } : {}),
    ...(scope ? { scope } : {}),
    ...(cwdOf ? { cwdOf } : {}),
    ...(isHangarPane ? { isHangarPane } : {}),
    getSubscriptions: () => subs as never[],
    dispatch: async (kind, _subs, _vapid, about) => {
      kinds.push(kind);
      abouts.push(about);
      return { attempted: 1 };
    },
    warn: (message) => warnings.push(message),
    setTimeoutFn: (fn, ms) => {
      const id = ++nextId;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeoutFn: (id) => {
      timers.delete(id as number);
    },
  });

  const advance = async (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.fn();
      }
    }
    await Promise.resolve();
  };

  return { notifier, kinds, abouts, warnings, tracker, advance, timers };
}

/** Lets the flush's own awaits (the cwd lookup, then dispatch) run out. */
async function drain() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("BlockedPushesImmediately", () => {
  test("a blocked pane in scope dispatches at once, with no window", async () => {
    const h = build();
    await h.notifier.onAgentStatus("p1", "blocked");
    expect(h.kinds).toEqual(["permission"]);
  });

  test("a blocked pane out of scope dispatches nothing", async () => {
    const h = build({ driven: false });
    await h.notifier.onAgentStatus("p1", "blocked");
    expect(h.kinds).toEqual([]);
  });

  test("a dispatch that rejects is warned, not thrown at the process", async () => {
    const warnings: string[] = [];
    const tracker = createPhoneDrivenTracker();
    tracker.markSent("p1");
    const notifier = createPushNotifier({
      phoneDriven: tracker,
      getSubscriptions: () => [SUB] as never[],
      dispatch: async () => {
        throw new Error("transport boom");
      },
      warn: (message) => warnings.push(message),
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });
    await notifier.onAgentStatus("p1", "blocked");
    expect(warnings.some((message) => message.includes("transport boom"))).toBe(true);
  });
});

describe("DoneOpensMergeWindow", () => {
  test("nothing goes out until the window has elapsed", async () => {
    const h = build();
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS - 1);
    expect(h.kinds).toEqual([]);
    await h.advance(1);
    expect(h.kinds).toEqual(["turn"]);
  });
});

describe("ScopeVerdictCapturedAtEnqueue", () => {
  test("a verdict spent after the turn ended does not cancel the notification", async () => {
    const h = build();
    await h.notifier.onAgentStatus("p1", "done");
    // Whoever asks 45 s from now would be told "not phone-driven"; the answer
    // that counts was taken when the turn ended.
    h.tracker.forget("p1");
    await h.advance(TURN_PUSH_WINDOW_MS);
    expect(h.kinds).toEqual(["turn"]);
  });

  test("a pane out of scope when its turn ends arms nothing", async () => {
    const h = build({ driven: false });
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual([]);
  });

  test("a later out-of-scope completion cancels the armed one", async () => {
    // Otherwise a timer armed under an old verdict outlives the verdict.
    const h = build();
    await h.notifier.onAgentStatus("p1", "done");
    h.tracker.forget("p1");
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual([]);
  });
});

describe("NonPushingStatuses", () => {
  test("idle, working and an unrecognised status each dispatch nothing", async () => {
    const h = build();
    await h.notifier.onAgentStatus("p1", "idle");
    await h.notifier.onAgentStatus("p1", "working");
    await h.notifier.onAgentStatus("p1", "unknown");
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual([]);
  });

  test("idle does not cancel a pending completion", async () => {
    // `done` marked seen decays to `idle`. That is the same turn, not a new one.
    const h = build();
    await h.notifier.onAgentStatus("p1", "done");
    await h.notifier.onAgentStatus("p1", "idle");
    await h.advance(TURN_PUSH_WINDOW_MS);
    expect(h.kinds).toEqual(["turn"]);
  });

  test("an unrecognised status cancels a pending completion", async () => {
    // herdr saying it cannot tell is not a basis for announcing a finished turn.
    const h = build();
    await h.notifier.onAgentStatus("p1", "done");
    await h.notifier.onAgentStatus("p1", "unknown");
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual([]);
  });
});

describe("NewTurnDropsPendingWindow", () => {
  test("work restarting inside the window drops that notification for good", async () => {
    const h = build();
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(10_000);
    await h.notifier.onAgentStatus("p1", "working");
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual([]);
  });

  test("the next completion opens a fresh window rather than resuming the old one", async () => {
    const h = build();
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(40_000);
    await h.notifier.onAgentStatus("p1", "working");
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS - 1);
    expect(h.kinds).toEqual([]);
    await h.advance(1);
    expect(h.kinds).toEqual(["turn"]);
  });
});

describe("MergedWindowOneDispatch", () => {
  test("the first expiry flushes every pending pane as one dispatch", async () => {
    const h = build();
    h.tracker.markSent("p2");
    h.tracker.markSent("p3");
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(20_000);
    await h.notifier.onAgentStatus("p2", "done");
    await h.advance(20_000);
    await h.notifier.onAgentStatus("p3", "done");
    await h.advance(6_000);
    expect(h.kinds).toEqual(["turn"]);
    // The later panes' own timers were cleared by the flush, not left to trail.
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual(["turn"]);
  });

  test("panes are judged one by one; an out-of-scope pane joins no batch", async () => {
    const h = build();
    await h.notifier.onAgentStatus("p2", "done");
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual([]);
  });
});

describe("PaneTeardownDropsPendingPush", () => {
  test("forget cancels an armed pane", async () => {
    const h = build();
    await h.notifier.onAgentStatus("p1", "done");
    h.notifier.forget("p1");
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual([]);
  });

  test("forgetting an unknown pane is inert", async () => {
    const h = build();
    expect(() => h.notifier.forget("nope")).not.toThrow();
  });
});

describe("push scope", () => {
  test("with no subscriber nothing is dispatched and no window is armed", async () => {
    const h = build({ subs: [] });
    await h.notifier.onAgentStatus("p1", "blocked");
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual([]);
  });

  test("scope all notifies about a pane the phone never spoke into", async () => {
    const h = build({ driven: false, scope: "all" });
    await h.notifier.onAgentStatus("p1", "blocked");
    expect(h.kinds).toEqual(["permission"]);
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS);
    expect(h.kinds).toEqual(["permission", "turn"]);
  });

  test("with no tracker wired nothing is sent, and it says so once", async () => {
    // A scope gate that answers "no" forever is indistinguishable from a quiet
    // machine, so the wiring bug has to announce itself.
    const h = build({ tracker: false });
    await h.notifier.onAgentStatus("p1", "blocked");
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS * 4);
    expect(h.kinds).toEqual([]);
    expect(
      h.warnings.filter((message) => message.includes("no send tracker is wired")),
    ).toHaveLength(1);
  });
});

describe("PushCopyNamesOnePane", () => {
  test("a batch of one pane is described by that pane's cwd", async () => {
    const h = build({ cwdOf: async (paneId) => `/srv/${paneId}-project` });
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS);
    await drain();
    expect(h.abouts).toEqual([{ cwd: "/srv/p1-project" }]);
  });

  test("a batch of several panes is only counted, and no cwd is looked up", async () => {
    const asked: string[] = [];
    const h = build({
      cwdOf: async (paneId) => {
        asked.push(paneId);
        return `/srv/${paneId}`;
      },
    });
    h.tracker.markSent("p2");
    h.tracker.markSent("p3");
    await h.notifier.onAgentStatus("p1", "done");
    await h.notifier.onAgentStatus("p2", "done");
    await h.notifier.onAgentStatus("p3", "done");
    await h.advance(TURN_PUSH_WINDOW_MS);
    await drain();
    expect(h.abouts).toEqual([{ count: 3 }]);
    expect(asked).toEqual([]);
  });

  test("a blocked pane is described by its cwd", async () => {
    const h = build({ cwdOf: async () => "/srv/blocked-project" });
    await h.notifier.onAgentStatus("p1", "blocked");
    expect(h.abouts).toEqual([{ cwd: "/srv/blocked-project" }]);
  });

  test("a cwd lookup that fails still sends, with no cwd to name", async () => {
    const h = build({
      cwdOf: async () => {
        throw new Error("daemon gone");
      },
    });
    await h.notifier.onAgentStatus("p1", "blocked");
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS);
    await drain();
    expect(h.kinds).toEqual(["permission", "turn"]);
    expect(h.abouts).toEqual([{ cwd: null }, { cwd: null }]);
  });

  test("a `done` arriving during the lookup starts the next batch, not this one", async () => {
    let release: (cwd: string) => void = () => {};
    const lookups: string[] = [];
    const h = build({
      cwdOf: (paneId) => {
        lookups.push(paneId);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    h.tracker.markSent("p2");
    await h.notifier.onAgentStatus("p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS);
    // p1's flush is waiting on its cwd; p2 finishes in the meantime.
    await h.notifier.onAgentStatus("p2", "done");
    release("/srv/one");
    await drain();
    expect(h.abouts).toEqual([{ cwd: "/srv/one" }]);

    await h.advance(TURN_PUSH_WINDOW_MS);
    release("/srv/two");
    await drain();
    expect(lookups).toEqual(["p1", "p2"]);
    expect(h.abouts).toEqual([{ cwd: "/srv/one" }, { cwd: "/srv/two" }]);
  });
});

describe("PushScopeBySide", () => {
  const hangar = (k: string) => k.startsWith("fleet@");
  const cwdOf = async (k: string) => `/work/${k}`;

  test("a hangar pane's finished turn pushes with an empty tracker", async () => {
    const h = build({ driven: false, isHangarPane: hangar, cwdOf });
    await h.notifier.onAgentStatus("fleet@w1:p1", "working");
    await h.notifier.onAgentStatus("fleet@w1:p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS);
    await drain();
    expect(h.kinds).toEqual(["turn"]);
    expect(h.abouts).toEqual([{ cwd: "/work/fleet@w1:p1" }]);
  });

  test("a cockpit pane stays out of scope when the tracker never saw it", async () => {
    const h = build({ driven: false, isHangarPane: hangar });
    await h.notifier.onAgentStatus("w1:p1", "working");
    await h.notifier.onAgentStatus("w1:p1", "done");
    expect(h.timers.size).toBe(0);
    await h.advance(TURN_PUSH_WINDOW_MS);
    await drain();
    expect(h.kinds).toEqual([]);
  });

  test("a hangar pane's blocked dispatches at once", async () => {
    const h = build({ driven: false, isHangarPane: hangar });
    await h.notifier.onAgentStatus("fleet@w1:p1", "working");
    await h.notifier.onAgentStatus("fleet@w1:p1", "blocked");
    expect(h.kinds).toEqual(["permission"]);
  });

  test("cockpit and hangar turns finishing together merge into one push", async () => {
    const h = build({ driven: false, isHangarPane: hangar });
    h.tracker.markSent("w1:p1");
    h.tracker.onTurnStart("w1:p1");
    await h.notifier.onAgentStatus("w1:p1", "working");
    await h.notifier.onAgentStatus("fleet@w2:p1", "working");
    await h.notifier.onAgentStatus("w1:p1", "done");
    await h.notifier.onAgentStatus("fleet@w2:p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS);
    await drain();
    expect(h.kinds).toEqual(["turn"]);
    expect(h.abouts).toEqual([{ count: 2 }]);
  });

  test("without isHangarPane, scope all still pushes a cockpit turn", async () => {
    const h = build({ driven: false, scope: "all" });
    await h.notifier.onAgentStatus("w1:p1", "working");
    await h.notifier.onAgentStatus("w1:p1", "done");
    await h.advance(TURN_PUSH_WINDOW_MS);
    await drain();
    expect(h.kinds).toEqual(["turn"]);
  });

  test("a hangar pane with no subscriptions dispatches nothing", async () => {
    const h = build({ subs: [], isHangarPane: hangar });
    await h.notifier.onAgentStatus("fleet@w1:p1", "working");
    await h.notifier.onAgentStatus("fleet@w1:p1", "done");
    await h.notifier.onAgentStatus("fleet@w1:p1", "blocked");
    await h.advance(TURN_PUSH_WINDOW_MS);
    await drain();
    expect(h.kinds).toEqual([]);
  });
});

describe("HangarFirstSightDoneSilent", () => {
  const hangar = (k: string) => k.startsWith("fleet@");
  const K = "fleet@w1:p1";

  test("a hangar pane first seen as done arms nothing", async () => {
    const h = build({ driven: false, isHangarPane: hangar });
    await h.notifier.onAgentStatus(K, "done");
    expect(h.timers.size).toBe(0);
    expect(h.kinds).toEqual([]);
  });

  test("a hangar pane first seen as blocked dispatches", async () => {
    const h = build({ driven: false, isHangarPane: hangar });
    await h.notifier.onAgentStatus(K, "blocked");
    expect(h.kinds).toEqual(["permission"]);
  });

  test("idle, working, done arms the window", async () => {
    const h = build({ driven: false, isHangarPane: hangar });
    await h.notifier.onAgentStatus(K, "idle");
    await h.notifier.onAgentStatus(K, "working");
    await h.notifier.onAgentStatus(K, "done");
    expect(h.timers.size).toBe(1);
  });

  test("a silent first done does not silence the next done", async () => {
    const h = build({ driven: false, isHangarPane: hangar });
    await h.notifier.onAgentStatus(K, "done");
    await h.notifier.onAgentStatus(K, "working");
    await h.notifier.onAgentStatus(K, "done");
    expect(h.timers.size).toBe(1);
  });

  test("forget makes the next report a first report again", async () => {
    const h = build({ driven: false, isHangarPane: hangar });
    await h.notifier.onAgentStatus(K, "done");
    h.notifier.forget(K);
    await h.notifier.onAgentStatus(K, "done");
    expect(h.timers.size).toBe(0);
  });

  test("a cockpit pane's first done still arms under scope all", async () => {
    const h = build({ driven: false, scope: "all", isHangarPane: hangar });
    await h.notifier.onAgentStatus("w1:p1", "done");
    expect(h.timers.size).toBe(1);
  });
});
