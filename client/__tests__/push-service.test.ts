import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  __resetForTests,
  getCachedPublicKey,
  primePublicKey,
  resyncPushSubscription,
  uploadSubscription,
} from "../services/push-service";
import { swRegistrationManager } from "../services/sw-registration";

/**
 * PushPublicKeyPrimedAtStartup contract tests.
 * The key is fetched at startup so the subscribe gesture never awaits network.
 */

const realFetch = globalThis.fetch;

describe("PushPublicKeyPrimedAtStartup", () => {
  beforeEach(() => {
    (globalThis as { __BASE_PATH__?: string }).__BASE_PATH__ = "";
    __resetForTests();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('T1: given startup priming with fetch stubbed to 200 {"publicKey":"BPk"} -> expect getCachedPublicKey() === "BPk" after the priming promise resolves', async () => {
    globalThis.fetch = (async (url: string) => {
      expect(url).toContain("/api/push/public-key");
      return new Response(JSON.stringify({ publicKey: "BPk" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await primePublicKey();
    expect(getCachedPublicKey()).toBe("BPk");
  });

  test("T2: given startup priming with fetch stubbed to 503 -> expect getCachedPublicKey() === null and no unhandled rejection", async () => {
    globalThis.fetch = (async () => {
      return new Response("error", { status: 503 });
    }) as unknown as typeof fetch;

    await primePublicKey();
    expect(getCachedPublicKey()).toBe(null);
  });

  test("T3: given startup priming with fetch rejecting -> expect getCachedPublicKey() === null and no unhandled rejection", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network fail");
    }) as unknown as typeof fetch;

    await primePublicKey();
    expect(getCachedPublicKey()).toBe(null);
  });
});

/**
 * PushSubscriptionResync contract tests (appended to this file per touches).
 * Re-uploads current (or fresh) sub on open when enabled+granted; never prompts.
 */

import * as PushSvc from "../services/push-service";

describe("PushSubscriptionResync", () => {
  const realFetch = globalThis.fetch;
  let origGetReg: any;
  let origReg: any;
  let origNotif: any;

  beforeEach(() => {
    __resetForTests();
    (globalThis as any).__BASE_PATH__ = "";
    globalThis.fetch = realFetch;

    origGetReg = (swRegistrationManager as any).getRegistration;
    origReg = (swRegistrationManager as any).registration;
    origNotif = (window as any).Notification;

    (swRegistrationManager as any).registration = null;
    (swRegistrationManager as any).getRegistration = () =>
      (swRegistrationManager as any).registration;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    (swRegistrationManager as any).getRegistration = origGetReg;
    (swRegistrationManager as any).registration = origReg;
    (window as any).Notification = origNotif;
  });

  test('T1: given resync({enabled:true}) with permission "granted" and getSubscription() returning an existing subscription -> expect upload called once with that subscription, result "uploaded", subscribe not called', async () => {
    (window as any).Notification = { permission: "granted" };
    const existing = {
      toJSON: () => ({
        endpoint: "https://web.push.apple.com/ex",
        keys: { p256dh: "p", auth: "a" },
      }),
    };
    const getSub = mock(() => Promise.resolve(existing));
    const subSpy = mock(() => Promise.resolve(null));
    const fakeReg = { pushManager: { getSubscription: getSub, subscribe: subSpy } } as any;
    (swRegistrationManager as any).registration = fakeReg;

    const up = mock((_sub: unknown) => Promise.resolve());
    const s = spyOn(PushSvc, "uploadSubscription").mockImplementation(up as any);

    const res = await resyncPushSubscription({ enabled: true });
    expect(res).toBe("uploaded");
    expect(up).toHaveBeenCalledTimes(1);
    expect(up.mock.calls[0][0]).toEqual({
      endpoint: "https://web.push.apple.com/ex",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(subSpy).not.toHaveBeenCalled();
    s.mockRestore();
  });

  test('T2: given resync({enabled:true}) with permission "granted" and getSubscription() returning null -> expect subscribe called once then upload called once, result "uploaded"', async () => {
    (window as any).Notification = { permission: "granted" };
    // need key for subscribe path
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ publicKey: "k" }), { status: 200 })) as unknown as typeof fetch;
    await primePublicKey();

    const newSub = { toJSON: () => ({ endpoint: "n", keys: { p256dh: "p2", auth: "a2" } }) };
    const getSub = mock(() => Promise.resolve(null));
    const subSpy = mock(() => Promise.resolve(newSub));
    const fakeReg = { pushManager: { getSubscription: getSub, subscribe: subSpy } } as any;
    (swRegistrationManager as any).registration = fakeReg;

    const up = mock(() => Promise.resolve());
    const s = spyOn(PushSvc, "uploadSubscription").mockImplementation(up as any);

    const res = await resyncPushSubscription({ enabled: true });
    expect(res).toBe("uploaded");
    expect(subSpy).toHaveBeenCalledTimes(1);
    expect(up).toHaveBeenCalledTimes(1);
    s.mockRestore();
  });

  test('T3: given resync({enabled:false}) -> expect result "skipped", no subscribe, no upload', async () => {
    const getSub = mock(() => Promise.resolve(null));
    const subSpy = mock(() => Promise.resolve(null));
    const fakeReg = { pushManager: { getSubscription: getSub, subscribe: subSpy } } as any;
    (swRegistrationManager as any).registration = fakeReg;

    const up = mock(() => Promise.resolve());
    const s = spyOn(PushSvc, "uploadSubscription").mockImplementation(up as any);

    const res = await resyncPushSubscription({ enabled: false });
    expect(res).toBe("skipped");
    expect(getSub).not.toHaveBeenCalled();
    expect(subSpy).not.toHaveBeenCalled();
    expect(up).not.toHaveBeenCalled();
    s.mockRestore();
  });

  test('T4: given resync({enabled:true}) with permission "default" -> expect result "skipped", no subscribe (no prompt outside a gesture)', async () => {
    (window as any).Notification = { permission: "default" };
    const getSub = mock(() => Promise.resolve(null));
    const subSpy = mock(() => Promise.resolve(null));
    const fakeReg = { pushManager: { getSubscription: getSub, subscribe: subSpy } } as any;
    (swRegistrationManager as any).registration = fakeReg;

    const up = mock(() => Promise.resolve());
    const s = spyOn(PushSvc, "uploadSubscription").mockImplementation(up as any);

    const res = await resyncPushSubscription({ enabled: true });
    expect(res).toBe("skipped");
    expect(subSpy).not.toHaveBeenCalled();
    s.mockRestore();
  });

  test('T5: given resync({enabled:true}) where upload rejects -> expect result "skipped", no thrown error, no toast', async () => {
    (window as any).Notification = { permission: "granted" };
    const existing = { toJSON: () => ({}) };
    const getSub = mock(() => Promise.resolve(existing));
    const fakeReg = { pushManager: { getSubscription: getSub, subscribe: mock() } } as any;
    (swRegistrationManager as any).registration = fakeReg;

    const up = mock(() => Promise.reject(new Error("net")));
    const s = spyOn(PushSvc, "uploadSubscription").mockImplementation(up as any);

    const res = await resyncPushSubscription({ enabled: true });
    expect(res).toBe("skipped");
    s.mockRestore();
  });
});

/**
 * PushSubscriptionUpload contract tests (appended).
 */
describe("PushSubscriptionUpload", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as { __BASE_PATH__?: string }).__BASE_PATH__ = "";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('T1: given uploadSubscription({endpoint:"https://web.push.apple.com/abc", keys:{p256dh:"BN",auth:"k1"}}) with window.__BASE_PATH__ unset and fetch stubbed to 201 -> expect fetch called with "/api/push/subscribe", method POST, content-type application/json, and that exact JSON body', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response("", { status: 201 });
    }) as unknown as typeof fetch;

    await uploadSubscription({
      endpoint: "https://web.push.apple.com/abc",
      keys: { p256dh: "BN", auth: "k1" },
    });

    expect(captured).not.toBeNull();
    expect((captured as any).url).toBe("/api/push/subscribe");
    expect((captured as any).init.method).toBe("POST");
    expect((captured as any).init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse((captured as any).init.body as string)).toEqual({
      endpoint: "https://web.push.apple.com/abc",
      keys: { p256dh: "BN", auth: "k1" },
    });
  });

  test('T2: given the same call with window.__BASE_PATH__ = "/cc" -> expect fetch called with "/cc/api/push/subscribe"', async () => {
    (globalThis as any).__BASE_PATH__ = "/cc";
    let capturedUrl = "";
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response("", { status: 201 });
    }) as unknown as typeof fetch;

    await uploadSubscription({ endpoint: "e", keys: { p256dh: "p", auth: "a" } });
    expect(capturedUrl).toBe("/cc/api/push/subscribe");
  });

  test('T3: given fetch stubbed to 400 with body {"error":"endpoint_not_allowed"} -> expect the promise rejects with a message containing endpoint_not_allowed', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "endpoint_not_allowed" }), { status: 400 });
    }) as unknown as typeof fetch;

    await expect(
      uploadSubscription({ endpoint: "e", keys: { p256dh: "p", auth: "a" } }),
    ).rejects.toThrow(/endpoint_not_allowed/);
  });
});
