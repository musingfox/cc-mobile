/**
 * manifest.test.ts — the manifest the build ships: the real
 * `public/manifest.json`, run through the same `stampManifest` the build runs.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stampManifest } from "../../pwa-stamp";

const SOURCE = readFileSync(join(import.meta.dir, "..", "public", "manifest.json"), "utf-8");

function shipped(basePath: string) {
  return JSON.parse(stampManifest(SOURCE, basePath));
}

describe("Manifest start_url", () => {
  test("empty BASE_PATH → start_url: /", () => {
    expect(shipped("").start_url).toBe("/");
  });

  test('BASE_PATH="/cc" → start_url: /cc/', () => {
    expect(shipped("/cc").start_url).toBe("/cc/");
  });
});
