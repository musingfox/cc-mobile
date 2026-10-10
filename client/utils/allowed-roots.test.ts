import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isWithinRoot } from "../../server/path-utils";
import { isWithinAllowedRoots } from "./allowed-roots";

describe("isWithinAllowedRoots", () => {
  const cases: [string, string, string[] | null, boolean][] = [
    ["T1", "/a/b", ["/a"], true],
    ["T2", "/a", ["/a"], true],
    ["T3", "/ab", ["/a"], false],
    ["T4", "/", ["/a"], false],
    ["T5", "/x", ["/"], true],
    ["T6", "/", ["/"], true],
    ["T7", "/a/c/d", ["/b", "/a/c"], true],
    ["T8", "/a", ["/b", "/a/c"], false],
    ["T9", "/anything", null, true],
    ["T10", "/a", [], false],
  ];
  for (const [id, path, roots, want] of cases) {
    test(`${id}: ${path} in ${JSON.stringify(roots)} -> ${want}`, () => {
      expect(isWithinAllowedRoots(path, roots)).toBe(want);
    });
  }

  test("T11: agrees with the server's isWithinRoot on every pair", () => {
    for (const p of ["/", "/a", "/ab", "/a/b", "/b"]) {
      for (const r of ["/", "/a", "/a/b"]) {
        expect(isWithinAllowedRoots(p, [r])).toBe(isWithinRoot(p, r));
      }
    }
  });

  test("T12: the module imports nothing", () => {
    const src = readFileSync(new URL("./allowed-roots.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
