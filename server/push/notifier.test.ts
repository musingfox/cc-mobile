import { describe, expect, test } from "bun:test";
import { createPushNotifier } from "./notifier";

describe("PushScopeSelfLaunchedOnly", () => {
  test("T1: onTurn self + subs -> dispatch turn once", async () => {
    let disp = 0;
    const n = createPushNotifier({
      getOrigin: async () => "self",
      dispatch: async (k) => {
        if (k === "turn") disp++;
        return { attempted: 1 };
      },
      getSubscriptions: () => [{ endpoint: "e", keys: {} } as any],
    });
    await n.onTurnSettled("p1");
    expect(disp).toBe(1);
  });

  test("T2: onTurn foreign -> no dispatch", async () => {
    let disp = 0;
    const n = createPushNotifier({
      getOrigin: async () => "foreign",
      dispatch: async () => {
        disp++;
        return { attempted: 0 };
      },
      getSubscriptions: () => [{ endpoint: "e", keys: {} } as any],
    });
    await n.onTurnSettled("p2");
    expect(disp).toBe(0);
  });

  test("T3: onPerm foreign -> no", async () => {
    let d = 0;
    const n = createPushNotifier({
      getOrigin: async () => "foreign",
      dispatch: async () => {
        d++;
        return { attempted: 0 };
      },
      getSubscriptions: () => [{} as any],
    });
    await n.onPermissionPrompt("p1", "foreign");
    expect(d).toBe(0);
  });

  test("T4: onPerm self + 0 subs -> no dispatch", async () => {
    let d = 0;
    const n = createPushNotifier({
      getOrigin: async () => "self",
      dispatch: async () => {
        d++;
        return { attempted: 0 };
      },
      getSubscriptions: () => [],
    });
    await n.onPermissionPrompt("p1", "self");
    expect(d).toBe(0);
  });

  test("T5: onTurn 0 subs -> origin lookup never called", async () => {
    let looked = false;
    const n = createPushNotifier({
      getOrigin: async () => {
        looked = true;
        return "self";
      },
      dispatch: async () => ({ attempted: 0 }),
      getSubscriptions: () => [],
    });
    await n.onTurnSettled("p1");
    expect(looked).toBe(false);
  });

  test("T6: onTurn lookup rejects -> no dispatch, resolves", async () => {
    let d = 0;
    const n = createPushNotifier({
      getOrigin: async () => {
        throw new Error("fail");
      },
      dispatch: async () => {
        d++;
        return { attempted: 0 };
      },
      getSubscriptions: () => [{} as any],
    });
    let threw = false;
    try {
      await n.onTurnSettled("p3");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(d).toBe(0);
  });

  test("T7: a failing origin lookup warns once, not once per turn", async () => {
    const warnings: string[] = [];
    const n = createPushNotifier({
      getOrigin: async () => {
        throw new Error("daemon gone");
      },
      dispatch: async () => ({ attempted: 0 }),
      getSubscriptions: () => [{ endpoint: "e", keys: {} }],
      warn: (m) => warnings.push(m),
    });
    await n.onTurnSettled("p1");
    await n.onTurnSettled("p2");
    expect(warnings.length).toBe(1);
  });

  test("T8: with no getVapid supplied the sender is handed no credentials", async () => {
    const seen: Array<unknown> = [];
    const n = createPushNotifier({
      getOrigin: async () => "self",
      dispatch: async (_kind, _subs, vapid) => {
        seen.push(vapid);
        return { attempted: 0 };
      },
      getSubscriptions: () => [{ endpoint: "e", keys: {} }],
    });
    await n.onTurnSettled("p1");
    // Not a placeholder key pair: junk credentials would sail past the
    // sender's own "is push configured" guard.
    expect(seen).toEqual([undefined]);
  });
});
