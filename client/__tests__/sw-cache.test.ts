/**
 * sw-cache.test.ts — the real `public/sw.js`, stamped the way the build stamps
 * it, evaluated with `self`, `caches` and `fetch` passed in as parameters so
 * nothing global is replaced for the other test files.
 */

import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stampServiceWorker } from "../../pwa-stamp";

const SW_SOURCE = readFileSync(join(import.meta.dir, "..", "public", "sw.js"), "utf-8");

type Listener = (event: unknown) => void;

function loadServiceWorker(basePath: string, network: (request: unknown) => Promise<Response>) {
  const listeners: Record<string, Listener> = {};
  const cache = {
    addAll: mock((_urls: string[]) => Promise.resolve()),
    put: mock((_request: unknown, _response: Response) => Promise.resolve()),
  };
  const caches = {
    open: mock(() => Promise.resolve(cache)),
    match: mock(() => Promise.resolve(undefined)),
    keys: mock(() => Promise.resolve([])),
    delete: mock(() => Promise.resolve(true)),
  };
  const self = {
    addEventListener(type: string, handler: Listener) {
      listeners[type] = handler;
    },
    clients: { claim: mock(() => Promise.resolve()) },
    skipWaiting: mock(() => {}),
  };
  const source = stampServiceWorker(SW_SOURCE, { version: "test", basePath, isDev: false });
  new Function("self", "caches", "fetch", source)(self, caches, network);
  return { listeners, cache };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function fetchThrough(destination: string, url: string, response: Response) {
  const { listeners, cache } = loadServiceWorker("", () => Promise.resolve(response));
  const delivered = await new Promise<Response>((resolve) => {
    listeners.fetch({
      request: { url, mode: "no-cors", destination, method: "GET" },
      respondWith: resolve,
    });
  });
  await settle();
  return { delivered, cache };
}

describe("install precaches the shell under the base path", () => {
  test.each([
    ["", ["/", "/index.html", "/manifest.json", "/icons/icon-192.png"]],
    ["/cc", ["/cc/", "/cc/index.html", "/cc/manifest.json", "/cc/icons/icon-192.png"]],
  ])("BASE_PATH=%p", async (basePath, expected) => {
    const { listeners, cache } = loadServiceWorker(basePath, () => Promise.reject());
    let installed: Promise<unknown> | undefined;
    listeners.install({ waitUntil: (p: Promise<unknown>) => (installed = p) });
    await installed;
    const precached = cache.addAll.mock.calls[0][0];
    for (const path of expected) expect(precached).toContain(path);
    for (const path of precached) expect(path.startsWith(`${basePath}/`)).toBe(true);
  });
});

describe("a fetched response is cached only when it is what was asked for", () => {
  test("index.html answering a script request is passed through, not cached", async () => {
    const html = new Response("<html></html>", { headers: { "content-type": "text/html" } });
    const { delivered, cache } = await fetchThrough("script", "http://x/assets/gone.js", html);
    expect(delivered).toBe(html);
    expect(cache.put).not.toHaveBeenCalled();
  });

  test("a 404 for a script is passed through, not cached", async () => {
    const missing = new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
    const { delivered, cache } = await fetchThrough("script", "http://x/assets/gone.js", missing);
    expect(delivered.status).toBe(404);
    expect(cache.put).not.toHaveBeenCalled();
  });

  test.each([
    ["script", "http://x/assets/index-abc.js", "text/javascript;charset=utf-8"],
    ["style", "http://x/assets/index-abc.css", "text/css"],
    ["image", "http://x/icons/icon-192.png", "image/png"],
    ["font", "http://x/assets/inter-latin-400.woff2", "font/woff2"],
  ])("a %s request for %s is cached", async (destination, url, contentType) => {
    const ok = new Response("body", { headers: { "content-type": contentType } });
    const { cache } = await fetchThrough(destination, url, ok);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  test("a request with no cacheable destination is not cached", async () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    const { cache } = await fetchThrough("", "http://x/data.json", json);
    expect(cache.put).not.toHaveBeenCalled();
  });
});
