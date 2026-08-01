import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { getInitialBrowsePath, listDirectories } from "../directory-listing";

describe("getInitialBrowsePath", () => {
  test("returns first allowed root when array is non-empty", () => {
    const result = getInitialBrowsePath(["/a", "/b"], "/home");
    expect(result).toBe("/a");
  });

  test("returns homeDirectory when allowedRoots is null", () => {
    const result = getInitialBrowsePath(null, "/home");
    expect(result).toBe("/home");
  });

  test("returns homeDirectory when allowedRoots is empty array", () => {
    const result = getInitialBrowsePath([], "/home");
    expect(result).toBe("/home");
  });
});

describe("listDirectories", () => {
  // realpathSync normalizes macOS /tmp → /private/tmp so asserted paths match
  // what the symlink-resolving allowed-roots check produces.
  const testRoot = join(realpathSync(tmpdir()), `cc-mobile-test-${Date.now()}`);
  const workspace = join(testRoot, "workspace");

  beforeAll(() => {
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, "project-b"), { recursive: true });
    mkdirSync(join(workspace, "project-a"), { recursive: true });
    writeFileSync(join(workspace, "README.md"), "test file");
  });

  afterAll(() => {
    try {
      rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("returns only directories, sorted, with files filtered out", () => {
    const result = listDirectories(workspace, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listing.entries).toEqual([
      { name: "project-a", path: join(workspace, "project-a") },
      { name: "project-b", path: join(workspace, "project-b") },
    ]);
  });

  test("reports the expanded path and its parent", () => {
    const result = listDirectories(workspace, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listing.path).toBe(workspace);
    expect(result.listing.parent).toBe(dirname(workspace));
  });

  test("returns a null parent at the filesystem root", () => {
    const result = listDirectories(sep, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listing.parent).toBeNull();
  });

  test("returns an empty entry list for a directory holding only files", () => {
    const onlyFiles = join(testRoot, "only-files");
    mkdirSync(onlyFiles, { recursive: true });
    writeFileSync(join(onlyFiles, "a.txt"), "x");

    const result = listDirectories(onlyFiles, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listing.entries).toEqual([]);
  });

  test("expands a leading tilde before listing", () => {
    const result = listDirectories("~", null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listing.path).toBe(homedir());
  });

  test("rejects a non-existent path with invalid_path", () => {
    const result = listDirectories("/nonexistent-cc-mobile-xyz", null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_path",
      message: "Path does not exist: /nonexistent-cc-mobile-xyz",
    });
  });

  test("rejects a file with invalid_path", () => {
    const file = join(workspace, "README.md");
    const result = listDirectories(file, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_path");
    expect(result.error.message).toBe(`Not a directory: ${file}`);
  });

  test("rejects a path outside the allowed roots", () => {
    const result = listDirectories(workspace, ["/somewhere/else"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "path_not_allowed",
      message: "Path is not in the allowed roots",
    });
  });
});
