import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const swPath = join(__dirname, "../public/sw.js");
const swContent = readFileSync(swPath, "utf-8");

// Setup global mocks and load sw.js once to register listeners (including the push one we will add)
const listeners: Record<string, (event: unknown) => void> = {};
const showNotification = mock(() => Promise.resolve());
const mockRegistration = { showNotification };
const mockClients = {
  matchAll: mock(() => Promise.resolve([])),
  openWindow: mock(() => Promise.resolve({})),
};
const mockSelf = {
  addEventListener(type: string, handler: unknown) {
    listeners[type] = handler as (event: unknown) => void;
  },
  registration: mockRegistration,
  clients: mockClients,
  location: { origin: "https://example.com" },
  __BASE_PATH__: "",
  skipWaiting: mock(() => {}),
};
globalThis.caches = {
  open: mock(() =>
    Promise.resolve({
      addAll: mock(() => Promise.resolve()),
      put: mock(() => Promise.resolve()),
    }),
  ),
  keys: mock(() => Promise.resolve([])),
  match: mock(() => Promise.resolve(undefined)),
  delete: mock(() => Promise.resolve(true)),
} as unknown as CacheStorage;
Object.defineProperty(globalThis, "self", {
  value: mockSelf,
  writable: true,
  configurable: true,
});

// sw.js is a plain script, not a module: run it with `self` bound as a
// parameter so its top-level addEventListener calls land in `listeners`.
new Function("self", swContent)(mockSelf);

const pushHandler = listeners["push"];

describe("SwPushAlwaysShowsNotification", () => {
  beforeEach(() => {
    showNotification.mockClear();
  });

  test('T1: given a push event whose data.json() returns {kind:"turn",title:"CCMobile",body:"A turn finished",tag:"cc-mobile-push-turn"} -> expect showNotification("CCMobile", {body:"A turn finished", tag:"cc-mobile-push-turn", renotify:true}) called exactly once', async () => {
    let waited: Promise<unknown> | undefined;
    const waitUntil = mock((p: Promise<unknown>) => {
      waited = p;
      return p;
    });
    const event = {
      data: {
        json: () =>
          Promise.resolve({
            kind: "turn",
            title: "CCMobile",
            body: "A turn finished",
            tag: "cc-mobile-push-turn",
          }),
        text: () => Promise.resolve(""),
      },
      waitUntil,
    };
    pushHandler(event);
    if (waited) await waited;
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith("CCMobile", {
      body: "A turn finished",
      tag: "cc-mobile-push-turn",
      renotify: true,
    });
  });

  test('T2: given a push event whose data.json() throws and data.text() returns "<<garbage" -> expect showNotification called exactly once with body "Something needs you"', async () => {
    let waited: Promise<unknown> | undefined;
    const waitUntil = mock((p: Promise<unknown>) => {
      waited = p;
      return p;
    });
    const event = {
      data: {
        json: () => Promise.reject(new Error("bad json")),
        text: () => Promise.resolve("<<garbage"),
      },
      waitUntil,
    };
    pushHandler(event);
    if (waited) await waited;
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(
      "CCMobile",
      expect.objectContaining({ body: "Something needs you" }),
    );
  });

  test("T3: given a push event with data === null -> expect showNotification called exactly once with the fallback copy", async () => {
    let waited: Promise<unknown> | undefined;
    const waitUntil = mock((p: Promise<unknown>) => {
      waited = p;
      return p;
    });
    const event = {
      data: null,
      waitUntil,
    };
    pushHandler(event);
    if (waited) await waited;
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(
      "CCMobile",
      expect.objectContaining({ body: "Something needs you" }),
    );
  });

  test("T4: given any of T1-T3 -> expect event.waitUntil called exactly once with a promise", async () => {
    let waited1: Promise<unknown> | undefined;
    const waitUntil1 = mock((p: Promise<unknown>) => {
      waited1 = p;
      return p;
    });
    const event1 = {
      data: {
        json: () => Promise.resolve({ kind: "turn", body: "x" }),
      },
      waitUntil: waitUntil1,
    };
    pushHandler(event1);
    expect(waitUntil1).toHaveBeenCalledTimes(1);
    const arg1 = waitUntil1.mock.calls[0][0];
    expect(arg1).toBeInstanceOf(Promise);

    let waited2: Promise<unknown> | undefined;
    const waitUntil2 = mock((p: Promise<unknown>) => {
      waited2 = p;
      return p;
    });
    const event2 = {
      data: {
        json: () => Promise.reject(new Error("x")),
        text: () => Promise.resolve("y"),
      },
      waitUntil: waitUntil2,
    };
    pushHandler(event2);
    expect(waitUntil2).toHaveBeenCalledTimes(1);
    const arg2 = waitUntil2.mock.calls[0][0];
    expect(arg2).toBeInstanceOf(Promise);
  });

  test("T6: a permission payload shows its own copy under its own tag", async () => {
    // It used to be discarded by a `kind === "turn"` gate, so a permission
    // push showed turn copy under the turn tag — and could coalesce over it.
    let waited: Promise<unknown> | undefined;
    const waitUntil = mock((p: Promise<unknown>) => {
      waited = p;
      return p;
    });
    pushHandler({
      data: {
        json: () =>
          Promise.resolve({
            kind: "permission",
            title: "CCMobile",
            body: "Permission needed",
            tag: "cc-mobile-push-permission",
          }),
      },
      waitUntil,
    });
    if (waited) await waited;
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith("CCMobile", {
      body: "Permission needed",
      tag: "cc-mobile-push-permission",
      renotify: true,
    });
  });

  test("T7: the fallback tag is the generic one, and an unparseable payload is warned about", async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      let waited: Promise<unknown> | undefined;
      const waitUntil = mock((p: Promise<unknown>) => {
        waited = p;
        return p;
      });
      pushHandler({
        data: {
          json: () => Promise.reject(new Error("bad json")),
          text: () => Promise.resolve("<<garbage"),
        },
        waitUntil,
      });
      if (waited) await waited;
      expect(showNotification).toHaveBeenCalledWith("CCMobile", {
        body: "Something needs you",
        tag: "cc-mobile-push",
        renotify: true,
      });
      expect(warnings.length).toBe(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("T8: the handler has no early return and one unconditional showNotification", () => {
    // Structural, not incidental: a branch that completes without showing a
    // notification is what makes Safari revoke the site's permission for good.
    const pushBlock = swContent.slice(swContent.indexOf('addEventListener("push"'));
    expect(pushBlock).not.toContain("return");
    const showCalls = pushBlock.match(/showNotification\(/g) ?? [];
    expect(showCalls).toHaveLength(1);
  });

  test('T5: given the source text of client/public/sw.js -> expect still contains "notificationclick", "client.focus" and "openWindow" (pre-existing handler undisturbed)', () => {
    expect(swContent).toContain("notificationclick");
    expect(swContent).toContain("client.focus");
    expect(swContent).toContain("openWindow");
  });
});
