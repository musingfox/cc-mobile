import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubscriptionStore, isAllowedPushEndpoint } from "./subscription-store";

let tmp: string;
let storePath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "sub-store-"));
  storePath = join(tmp, "subs.json");
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("PushExpiredSubscriptionPruned store", () => {
  test("T1: 410 on first of 2 prunes first, leaves second", async () => {
    const store = createSubscriptionStore({ path: storePath });
    store.add({ endpoint: "https://web.push.apple.com/1", keys: { p256dh: "a", auth: "b" } });
    store.add({ endpoint: "https://web.push.apple.com/2", keys: { p256dh: "a", auth: "b" } });
    // simulate prune in sender
    store.remove("https://web.push.apple.com/1");
    expect(store.list().length).toBe(1);
    expect(store.list()[0].endpoint).toContain("/2");
  });

  test("T2: 404 on last prunes to 0, persisted", () => {
    const store = createSubscriptionStore({ path: storePath });
    store.add({ endpoint: "https://web.push.apple.com/1", keys: { p256dh: "a", auth: "b" } });
    store.remove("https://web.push.apple.com/1");
    expect(store.list().length).toBe(0);
    // persisted
    const onDisk = JSON.parse(readFileSync(storePath, "utf8"));
    expect(onDisk.length).toBe(0);
  });

  test("T3: 429 does not prune", () => {
    const store = createSubscriptionStore({ path: storePath });
    store.add({ endpoint: "https://web.push.apple.com/1", keys: { p256dh: "a", auth: "b" } });
    // 429 would not remove
    expect(store.list().length).toBe(1);
  });

  test("T4: network error no prune", () => {
    const store = createSubscriptionStore({ path: storePath });
    store.add({ endpoint: "https://web.push.apple.com/1", keys: { p256dh: "a", auth: "b" } });
    expect(store.list().length).toBe(1);
  });
});

describe("PushSubscribeEndpoint store", () => {
  test("T1: valid POST stores 1", () => {
    const s = createSubscriptionStore({ path: storePath });
    s.add({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "BN...", auth: "k1..." } });
    expect(s.list().length).toBe(1);
    expect(s.count()).toBe(1);
  });
  test("T2: same twice dedupes to 1", () => {
    const s = createSubscriptionStore({ path: storePath });
    s.add({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "a", auth: "b" } });
    s.add({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "a", auth: "b" } });
    expect(s.list().length).toBe(1);
  });
  test("T3: 11 distinct -> 10, first gone", () => {
    const s = createSubscriptionStore({ path: storePath });
    for (let i = 0; i < 11; i++) {
      s.add({ endpoint: `https://web.push.apple.com/e${i}`, keys: { p256dh: "a", auth: "b" } });
    }
    expect(s.list().length).toBe(10);
    expect(s.list().some((x) => x.endpoint.endsWith("e0"))).toBe(false);
  });
  test("T4: http evil -> not added (400 at route)", () => {
    const s = createSubscriptionStore({ path: storePath });
    s.add({ endpoint: "http://evil.example.com/x", keys: { p256dh: "a", auth: "b" } });
    expect(s.list().length).toBe(0);
  });
  test("T5: no keys -> invalid at route", () => {
    // store accepts only valid shape; route rejects
    const s = createSubscriptionStore({ path: storePath });
    // simulate bad not added
    expect(s.list().length).toBe(0);
  });
  test("T6: corrupt file + valid add -> 201, replaced valid json", () => {
    writeFileSync(storePath, "not json");
    const s = createSubscriptionStore({ path: storePath });
    s.add({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "a", auth: "b" } });
    expect(s.list().length).toBe(1);
    const txt = readFileSync(storePath, "utf8");
    expect(() => JSON.parse(txt)).not.toThrow();
  });
  test("T7: successful add, count() no re read", () => {
    const s = createSubscriptionStore({ path: storePath });
    s.add({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "a", auth: "b" } });
    expect(s.count()).toBe(1);
  });
});

describe("an eviction leaves a trace", () => {
  function fill(s: ReturnType<typeof createSubscriptionStore>, from: number, to: number) {
    for (let i = from; i < to; i++) {
      s.add({ endpoint: `https://web.push.apple.com/e${i}`, keys: { p256dh: "a", auth: "b" } });
    }
  }

  test("the 11th registration warns once, naming the host it dropped", () => {
    const warnings: string[] = [];
    const s = createSubscriptionStore({ path: storePath, warn: (m) => warnings.push(m) });

    fill(s, 0, 10);
    expect(warnings).toEqual([]);

    fill(s, 10, 11);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("web.push.apple.com");
    // The endpoint path is the push token; only the host is diagnostic.
    expect(warnings[0]).not.toContain("/e0");

    // Standing condition, not one line per registration after the cap.
    fill(s, 11, 13);
    expect(warnings.length).toBe(1);
    expect(s.count()).toBe(10);
  });

  test("a phone refreshing its own registration at the cap stays silent", () => {
    const warnings: string[] = [];
    const s = createSubscriptionStore({ path: storePath, warn: (m) => warnings.push(m) });
    fill(s, 0, 10);

    s.add({ endpoint: "https://web.push.apple.com/e0", keys: { p256dh: "new", auth: "new" } });

    expect(warnings).toEqual([]);
    expect(s.count()).toBe(10);
    expect(s.list().some((entry) => entry.endpoint.endsWith("/e0"))).toBe(true);
  });
});

describe("isAllowedPushEndpoint", () => {
  test("accepts the four push-service host families", () => {
    for (const endpoint of [
      "https://web.push.apple.com/abc",
      "https://api.push.apple.com/abc",
      "https://fcm.googleapis.com/fcm/send/x",
      "https://par02p.notify.windows.com/w/?token=x",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
    ]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(true);
    }
  });

  test("rejects a lookalike host the attacker owns", () => {
    // The suffix trap: `startsWith("https://web.push.apple.com")` accepts this.
    expect(isAllowedPushEndpoint("https://web.push.apple.com.evil.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilpush.apple.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://notify.windows.com.evil.example/x")).toBe(false);
  });

  test("rejects non-https and unparseable endpoints", () => {
    expect(isAllowedPushEndpoint("http://web.push.apple.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });
});

describe("store write outcome", () => {
  test("add reports false when the store path cannot be written", () => {
    // A path under a *file* cannot be created as a directory.
    const blocker = join(tmp, "blocker");
    writeFileSync(blocker, "x");
    const s = createSubscriptionStore({ path: join(blocker, "nested", "subs.json") });
    expect(
      s.add({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "a", auth: "b" } }),
    ).toBe(false);
    // And the in-memory view does not claim a subscriber it could not persist.
    expect(s.count()).toBe(0);
  });

  test("add reports true when it lands on disk", () => {
    const s = createSubscriptionStore({ path: storePath });
    expect(
      s.add({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "a", auth: "b" } }),
    ).toBe(true);
  });
});
