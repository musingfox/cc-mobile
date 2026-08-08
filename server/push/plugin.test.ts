import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseServerConfig } from "../config";
import { createPushPlugin } from "./plugin";
import { createSubscriptionStore } from "./subscription-store";

let tmp: string;
let storePath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "plugin-"));
  storePath = join(tmp, "s.json");
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("PushPublicKeyEndpoint + subscribe", () => {
  test("T1: GET /api/push/public-key with keys -> 200 body", async () => {
    const env = { CC_MOBILE_VAPID_PUBLIC_KEY: "BPk...", CC_MOBILE_VAPID_PRIVATE_KEY: "x9..." };
    // patch process for load
    const orig = process.env;
    process.env = { ...orig, ...env } as any;
    const plugin = createPushPlugin({ store: createSubscriptionStore({ path: storePath }) });
    const res = await plugin.handle(new Request("http://localhost/api/push/public-key"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.publicKey).toBe("BPk...");
    process.env = orig;
  });

  test("T2: no keys -> 503 error push_not_configured", async () => {
    const orig = process.env;
    process.env = { ...orig } as any;
    delete process.env.CC_MOBILE_VAPID_PUBLIC_KEY;
    delete process.env.CC_MOBILE_VAPID_PRIVATE_KEY;
    const plugin = createPushPlugin({ store: createSubscriptionStore({ path: storePath }) });
    const res = await plugin.handle(new Request("http://localhost/api/push/public-key"));
    expect(res.status).toBe(503);
    const j = await res.json();
    expect(j.error).toBe("push_not_configured");
    process.env = orig;
  });

  test("T3: BASE_PATH=/cc serves /cc/api/..., bare 404", async () => {
    // The subject here is routing, so the keys are cleared rather than
    // inherited: read off the ambient environment this asserted 503 on a
    // machine with no VAPID configured and 200 on one that had some, which
    // makes a passing run say nothing about the base path.
    const orig = process.env;
    process.env = { ...orig } as any;
    delete process.env.CC_MOBILE_VAPID_PUBLIC_KEY;
    delete process.env.CC_MOBILE_VAPID_PRIVATE_KEY;
    try {
      const store = createSubscriptionStore({ path: storePath });
      const cfg = parseServerConfig([]);
      (cfg as any).basePath = "/cc";
      const plugin = createPushPlugin({ store, config: cfg });
      const r1 = await plugin.handle(new Request("http://localhost/cc/api/push/public-key"));
      expect(r1.status).toBe(503); // route hit, and deterministically unconfigured
      const r2 = await plugin.handle(new Request("http://localhost/api/push/public-key"));
      expect(r2.status).toBe(404);
    } finally {
      process.env = orig;
    }
  });

  // subscribe basic from other
  test("subscribe 201 on valid", async () => {
    const store = createSubscriptionStore({ path: storePath });
    const plugin = createPushPlugin({ store });
    const res = await plugin.handle(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://web.push.apple.com/abc",
          keys: { p256dh: "BN", auth: "k1" },
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(store.count()).toBe(1);
  });

  async function post(plugin: ReturnType<typeof createPushPlugin>, body: unknown) {
    return plugin.handle(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  test("subscribe rejects a host that merely starts with an allowed one", async () => {
    const store = createSubscriptionStore({ path: storePath });
    const plugin = createPushPlugin({ store });
    const res = await post(plugin, {
      endpoint: "https://web.push.apple.com.evil.example/x",
      keys: { p256dh: "a", auth: "b" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "endpoint_not_allowed" });
    expect(store.count()).toBe(0);
  });

  test("subscribe accepts the non-Apple push services", async () => {
    const store = createSubscriptionStore({ path: storePath });
    const plugin = createPushPlugin({ store });
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/x",
      "https://par02p.notify.windows.com/w/?token=x",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
    ]) {
      const res = await post(plugin, { endpoint, keys: { p256dh: "a", auth: "b" } });
      expect(res.status).toBe(201);
    }
    expect(store.count()).toBe(3);
  });

  test("subscribe 400 invalid_subscription when keys are missing", async () => {
    const plugin = createPushPlugin({ store: createSubscriptionStore({ path: storePath }) });
    const res = await post(plugin, { endpoint: "https://web.push.apple.com/abc" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_subscription" });
  });

  test("subscribe 400 endpoint_not_allowed on plain http", async () => {
    const plugin = createPushPlugin({ store: createSubscriptionStore({ path: storePath }) });
    const res = await post(plugin, {
      endpoint: "http://evil.example.com/x",
      keys: { p256dh: "a", auth: "b" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "endpoint_not_allowed" });
  });

  test("subscribe 500 store_write_failed when the store cannot be written", async () => {
    const blocker = join(tmp, "blocker");
    writeFileSync(blocker, "x");
    const store = createSubscriptionStore({ path: join(blocker, "nested", "subs.json") });
    const plugin = createPushPlugin({ store });
    const res = await post(plugin, {
      endpoint: "https://web.push.apple.com/abc",
      keys: { p256dh: "a", auth: "b" },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "store_write_failed" });
  });

  test("subscribe 201 twice dedupes and a corrupt store file is replaced", async () => {
    writeFileSync(storePath, "not json");
    const store = createSubscriptionStore({ path: storePath });
    const plugin = createPushPlugin({ store });
    const body = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "BN", auth: "k1" } };
    expect((await post(plugin, body)).status).toBe(201);
    expect((await post(plugin, body)).status).toBe(201);
    expect(store.count()).toBe(1);
    expect(() => JSON.parse(readFileSync(storePath, "utf8"))).not.toThrow();
  });
});
