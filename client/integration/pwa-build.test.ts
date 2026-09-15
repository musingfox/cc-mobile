/**
 * pwa-build.test.ts — TC13, the PWA build check, kept out of the commit gate.
 *
 * This test spawns `bun run build` and asserts the PWA files land in
 * `dist/client`. Both halves put it outside the unit tier that
 * `docs/spec/test-tier-by-dependency.md` defines: it starts a process, and it
 * writes outside `tmpdir()` — into `dist/client`, which is `server/app.ts`'s
 * `DIST_DIR` and what pm2's `cc-mobile-prod` serves. Each run re-stamps
 * `sw.js`'s `CACHE_NAME`, so collecting it in the commit gate made every
 * commit purge the phone's PWA cache.
 *
 * It lives here rather than in `client/__tests__/pwa.test.ts` because
 * `pathIgnorePatterns` excludes by path and the other seventeen tests in that
 * file are ordinary unit tests. Run it with `bun run test:build`.
 *
 * What it asserts — that vite copies `public/` into `dist/` — is untouched by
 * the move; whether the assertion earns its sixty seconds is a separate
 * question, deliberately left open.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CLIENT_ROOT = join(import.meta.dir, "..");

describe("Build Integration", () => {
  test("TC13: Build succeeds with PWA files", async () => {
    // Run build
    const buildProcess = Bun.spawn(["bun", "run", "build"], {
      cwd: join(CLIENT_ROOT, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await buildProcess.exited;
    expect(exitCode).toBe(0);

    // Check that PWA files are copied to dist
    const distClientDir = join(CLIENT_ROOT, "..", "dist", "client");
    const distManifest = join(distClientDir, "manifest.json");
    const distSw = join(distClientDir, "sw.js");

    expect(existsSync(distManifest)).toBe(true);
    expect(existsSync(distSw)).toBe(true);
  }, 60_000);
});
