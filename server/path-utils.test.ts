/**
 * path-utils.test.ts — Unit tests for the path validation primitives
 * (expandPath / validateCwd / validateAllowedPath) and their composition
 * resolveAndValidateCwd. These three primitives are the single source of
 * truth: ws.ts used to carry a byte-identical private copy.
 *
 * Uses real FS (mkdtempSync) as required. resolveAndValidateCwd cases:
 *   1. Non-existent path → invalid_cwd
 *   2. Existing dir not in root → path_not_allowed
 *   3. Existing dir inside root → ok
 *   4. /foo vs /foobar sibling boundary (trailing-sep guard) → path_not_allowed
 *   5. null allowedRoots → ok
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expandPath, resolveAndValidateCwd, validateAllowedPath, validateCwd } from "./path-utils";

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

// ── PathValidationSingleSource: the primitives, individually ──────────────────

describe("expandPath", () => {
  it("expands a bare ~ to the absolute home directory", () => {
    expect(expandPath("~")).toBe(resolve(homedir(), ""));
  });

  it("expands ~/sub to a path under home", () => {
    expect(expandPath("~/sub")).toBe(join(homedir(), "sub"));
  });

  it("resolves a relative path against cwd", () => {
    expect(expandPath("./a")).toBe(resolve("./a"));
  });
});

describe("validateCwd", () => {
  it("returns null for an existing directory", () => {
    expect(validateCwd(tmpdir())).toBeNull();
  });

  it("returns the not-exist message for a missing path", () => {
    expect(validateCwd("/nonexistent-cc-mobile-xyz")).toBe(
      "Path does not exist: /nonexistent-cc-mobile-xyz",
    );
  });

  it("returns the not-a-directory message for a file", () => {
    const dir = makeTmpDir("file-check");
    const file = join(dir, "f.txt");
    writeFileSync(file, "x");
    expect(validateCwd(file)).toBe(`Not a directory: ${file}`);
  });
});

describe("validateAllowedPath", () => {
  it("allows anything when allowedRoots is null", () => {
    expect(validateAllowedPath("/anywhere", null)).toBe(true);
  });

  it("allows a subdirectory of an allowed root", () => {
    const root = makeTmpDir("allow-root");
    const sub = join(root, "sub");
    mkdirSync(sub);
    expect(validateAllowedPath(sub, [root])).toBe(true);
  });

  it("allows the root itself", () => {
    const root = makeTmpDir("allow-self");
    expect(validateAllowedPath(root, [root])).toBe(true);
  });

  it("rejects a path outside every allowed root", () => {
    const root = makeTmpDir("allow-outside");
    const other = makeTmpDir("other");
    expect(validateAllowedPath(other, [root])).toBe(false);
  });
});
