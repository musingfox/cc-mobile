/**
 * path-utils.test.ts — Unit tests for resolveAndValidateCwd
 *
 * Uses real FS (mkdtempSync) as required. Five cases:
 *   1. Non-existent path → invalid_cwd
 *   2. Existing dir not in root → path_not_allowed
 *   3. Existing dir inside root → ok
 *   4. /foo vs /foobar sibling boundary (trailing-sep guard) → path_not_allowed
 *   5. null allowedRoots → ok
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAndValidateCwd } from "./path-utils";

// ── Temp dir tracking ─────────────────────────────────────────────────────────

const toClean: string[] = [];

afterEach(() => {
  for (const d of toClean.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

function makeTmpDir(suffix = ""): string {
  const d = mkdtempSync(join(tmpdir(), `path-utils-test-${suffix}`));
  toClean.push(d);
  return realpathSync(d); // normalize macOS /tmp → /private/tmp
}

// ── Test cases ────────────────────────────────────────────────────────────────

describe("resolveAndValidateCwd — non-existent path → invalid_cwd", () => {
  it("/nonexistent-path-utils-test-xyz does not exist → invalid_cwd", () => {
    const result = resolveAndValidateCwd("/nonexistent-path-utils-test-xyz", null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_cwd");
  });
});

describe("resolveAndValidateCwd — real dir not in root → path_not_allowed", () => {
  it("existing tmpdir outside allowed root → path_not_allowed", () => {
    const cwd = makeTmpDir("cwd");
    const root = makeTmpDir("root");
    const result = resolveAndValidateCwd(cwd, [root]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("path_not_allowed");
  });
});

describe("resolveAndValidateCwd — real dir in root → ok", () => {
  it("subdir inside allowed root → ok:true", () => {
    const root = makeTmpDir("root");
    const subdir = join(root, "sub");
    mkdirSync(subdir);
    const result = resolveAndValidateCwd(subdir, [root]);
    expect(result.ok).toBe(true);
  });
});

describe("resolveAndValidateCwd — /foo vs /foobar sibling boundary → path_not_allowed", () => {
  it("foobar sibling dir is NOT inside foo dir (trailing-sep guard)", () => {
    const base = mkdtempSync(join(tmpdir(), "path-utils-test-base-"));
    toClean.push(base);
    const realBase = realpathSync(base);

    const foo = join(realBase, "foo");
    const foobar = join(realBase, "foobar");
    mkdirSync(foo);
    mkdirSync(foobar);

    // Without trailing-sep guard, foobar.startsWith(foo) would incorrectly return true
    const result = resolveAndValidateCwd(foobar, [foo]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("path_not_allowed");
  });
});

describe("resolveAndValidateCwd — null allowedRoots → ok", () => {
  it("existing tmpdir with null allowedRoots → ok:true", () => {
    const dir = makeTmpDir("null-roots");
    const result = resolveAndValidateCwd(dir, null);
    expect(result.ok).toBe(true);
  });
});
