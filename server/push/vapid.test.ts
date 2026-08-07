import { describe, expect, test } from "bun:test";
import { loadVapidKeys } from "./vapid";

describe("PushPublicKey VAPID", () => {
  test("T1: both keys -> return", () => {
    const v = loadVapidKeys({
      CC_MOBILE_VAPID_PUBLIC_KEY: "BPk...",
      CC_MOBILE_VAPID_PRIVATE_KEY: "x9...",
    });
    expect(v).toEqual({ publicKey: "BPk...", privateKey: "x9..." });
  });
  test("T2: unset -> null", () => {
    expect(loadVapidKeys({})).toBeNull();
    expect(loadVapidKeys({ CC_MOBILE_VAPID_PUBLIC_KEY: "p" })).toBeNull();
  });
});
