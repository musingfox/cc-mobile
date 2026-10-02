/**
 * pwa-stamp.test.ts — what `vite.config.ts`'s build plugins change in the
 * built PWA files, asserted on strings. The build itself is TC13's business
 * (client/integration/pwa-build.test.ts, outside the commit gate); these run
 * the same functions the plugins run, without building anything.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stampManifest, stampServiceWorker, substituteBasePath } from "../../pwa-stamp";

const CLIENT_ROOT = join(import.meta.dir, "..");
const PUBLIC_DIR = join(CLIENT_ROOT, "public");

const SW_FIXTURE = [
  'const CACHE_NAME = "cc-mobile-__BUILD_VERSION__";',
  'const BASE_PATH = self.__BASE_PATH__ || "";',
  'const ICONS = [BASE_PATH + "/icons/icon-192.png", BASE_PATH + "/icons/icon-512.png", BASE_PATH + "/icons/apple-touch-icon.png"];',
].join("\n");

const MANIFEST_FIXTURE = JSON.stringify({
  name: "CCMobile",
  start_url: "/",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192" },
    { src: "/icons/icon-512.png", sizes: "512x512" },
  ],
});

describe("stampServiceWorker", () => {
  test("stamps the build version into CACHE_NAME", () => {
    const out = stampServiceWorker(SW_FIXTURE, { version: "k3x9", basePath: "", isDev: false });
    expect(out).toContain('const CACHE_NAME = "cc-mobile-k3x9";');
    expect(out).not.toContain("__BUILD_VERSION__");
  });

  test("replaces self.__BASE_PATH__ with the quoted base path", () => {
    const empty = stampServiceWorker(SW_FIXTURE, { version: "v", basePath: "", isDev: false });
    const cc = stampServiceWorker(SW_FIXTURE, { version: "v", basePath: "/cc", isDev: false });
    expect(empty).toContain('const BASE_PATH = "" || "";');
    expect(cc).toContain('const BASE_PATH = "/cc" || "";');
  });

  test("a dev build points all three icons at their -dev variants", () => {
    const out = stampServiceWorker(SW_FIXTURE, { version: "v", basePath: "", isDev: true });
    expect(out).toContain('"/icons/icon-192-dev.png"');
    expect(out).toContain('"/icons/icon-512-dev.png"');
    expect(out).toContain('"/icons/apple-touch-icon-dev.png"');
    expect(out).not.toMatch(/icon-192\.png|icon-512\.png|apple-touch-icon\.png/);
  });

  test("a production build leaves the icon paths alone", () => {
    const out = stampServiceWorker(SW_FIXTURE, { version: "v", basePath: "", isDev: false });
    expect(out).not.toContain("-dev.png");
    expect(out).toContain('"/icons/icon-192.png"');
  });

  test("the real public/sw.js keeps no placeholder after stamping", () => {
    const source = readFileSync(join(PUBLIC_DIR, "sw.js"), "utf-8");
    const out = stampServiceWorker(source, { version: "k3x9", basePath: "/cc", isDev: false });
    expect(out).toContain('const CACHE_NAME = "cc-mobile-k3x9";');
    expect(out).not.toContain("__BUILD_VERSION__");
    expect(out).not.toContain("__BASE_PATH__");
  });
});

describe("substituteBasePath", () => {
  test("the real client/index.html keeps no placeholder after substitution", () => {
    const source = readFileSync(join(CLIENT_ROOT, "index.html"), "utf-8");
    const out = substituteBasePath(source, "/cc");
    expect(out).not.toContain("__BASE_PATH__/");
    expect(out).toContain('window.__BASE_PATH__ = "/cc"');
    expect(out).toContain('href="/cc/manifest.json"');
  });
});

describe("stampManifest", () => {
  test("start_url is the base path with a trailing slash", () => {
    expect(JSON.parse(stampManifest(MANIFEST_FIXTURE, "")).start_url).toBe("/");
    expect(JSON.parse(stampManifest(MANIFEST_FIXTURE, "/cc")).start_url).toBe("/cc/");
  });

  test("id and scope follow the base path, added when the source has none", () => {
    const cc = JSON.parse(stampManifest(MANIFEST_FIXTURE, "/cc"));
    expect(cc.id).toBe("/cc/");
    expect(cc.scope).toBe("/cc/");
    const root = JSON.parse(stampManifest(MANIFEST_FIXTURE, ""));
    expect(root.id).toBe("/");
    expect(root.scope).toBe("/");
  });

  test("every icon src is prefixed with the base path, other icon fields kept", () => {
    const icons = JSON.parse(stampManifest(MANIFEST_FIXTURE, "/cc")).icons;
    expect(icons).toEqual([
      { src: "/cc/icons/icon-192.png", sizes: "192x192" },
      { src: "/cc/icons/icon-512.png", sizes: "512x512" },
    ]);
  });

  test("output is two-space-indented JSON", () => {
    const out = stampManifest(MANIFEST_FIXTURE, "");
    expect(out).toBe(JSON.stringify(JSON.parse(out), null, 2));
  });

  test.each(["manifest.json", "manifest.dev.json"])("the real public/%s stamps cleanly", (name) => {
    const source = readFileSync(join(PUBLIC_DIR, name), "utf-8");
    const manifest = JSON.parse(stampManifest(source, "/cc"));
    expect(manifest.start_url).toBe("/cc/");
    for (const icon of manifest.icons) expect(icon.src.startsWith("/cc/icons/")).toBe(true);
  });
});
