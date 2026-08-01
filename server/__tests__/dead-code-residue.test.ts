/**
 * dead-code-residue.test.ts — DeadModuleResidueScan.
 *
 * #25 deleted three whole paths (SDK query, the PTY one-shot chain, the tmux
 * adapter) plus the Playwright suite. This scan is the guard that stops any of
 * them creeping back in via a stray import or a re-added script: every pattern
 * below must have zero hits across `server/` and `client/`.
 *
 * Patterns are assembled from fragments so this file does not match itself.
 * `docs/` is deliberately out of scope — the ADRs and spike logs describe what
 * was deleted and are supposed to keep saying so.
 *
 * Two files are excluded by name: this one, and the retired-message protocol
 * test, which has to spell the dead message names out in order to assert that
 * the schema refuses them.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const scanRoots = ["server", "client"].map((d) => join(repoRoot, d));

const EXCLUDED_FILES = new Set(["dead-code-residue.test.ts", "protocol-retired-messages.test.ts"]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (EXCLUDED_FILES.has(entry)) continue;
    out.push(full);
  }
  return out;
}

const sourceFiles = (() => {
  for (const root of scanRoots) {
    // A missing scan root means the scan would pass vacuously — fail loudly instead.
    if (!existsSync(root)) throw new Error(`scan root missing: ${root}`);
  }
  const files = scanRoots.flatMap((root) => collectSourceFiles(root));
  if (files.length === 0) throw new Error("scan found no source files");
  return files.map((path) => ({
    path: path.slice(repoRoot.length + 1),
    text: readFileSync(path, "utf8"),
  }));
})();

function hits(pattern: string): string[] {
  return sourceFiles.filter((f) => f.text.includes(pattern)).map((f) => f.path);
}

const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

describe("DeadModuleResidueScan — deleted modules", () => {
  const deletedModules = [
    // tmux adapter
    `tmux${"-"}registry`,
    `tmux${"-"}send-routing`,
    `create${"Tmux"}Backend`,
    // PTY one-shot chain
    `pty${"-"}orchestrator`,
    `pty${"-"}reader`,
    `pty${"-"}driver`,
    `pty${"-"}worker`,
    `tui${"-"}readiness`,
    `tui${"-"}capture`,
    // SDK query path
    `permission${"-"}bridge`,
    `settings${"-"}loader`,
    `save${"Cached"}Capabilities`,
    // The guard the deleted permission bridge put ahead of every WS case.
    `No permission ${"handler"}`,
  ];

  test.each(deletedModules)("no source file references %s", (pattern) => {
    expect(hits(pattern)).toEqual([]);
  });
});

describe("DeadModuleResidueScan — retired message names", () => {
  const retiredNames = [
    `tmux${"_"}`, // the whole tmux_* message family
    `pty${"_"}send`,
    `get${"_"}session_info`,
    // `new_session` / `send` / `command` are deliberately NOT scanned: they are
    // ordinary English words that appear as debug-log payloads and in prose,
    // and the schema-level proof that they are refused lives in
    // protocol-retired-messages.test.ts.
  ];

  test.each(retiredNames)("no source file mentions %s", (pattern) => {
    expect(hits(pattern)).toEqual([]);
  });
});

describe("DeadModuleResidueScan — dependency surface", () => {
  test("only session listing and history still import the agent SDK", () => {
    const sdk = `@anthropic-ai/claude${"-"}agent-sdk`;
    // Test files legitimately import SDK types to build fixtures for those two
    // modules; what must stay contained is the production surface.
    const production = hits(sdk).filter((p) => !p.includes(".test.") && !p.includes("__tests__"));
    expect(production.sort()).toEqual(["server/session-history.ts", "server/session-listing.ts"]);
  });

  test("the native pty dependency is gone from package.json", () => {
    const pty = `node${"-"}pty`;
    expect(Object.keys(packageJson.dependencies)).not.toContain(pty);
    expect(Object.keys(packageJson.devDependencies)).not.toContain(pty);
    expect(packageJson.scripts.postinstall ?? "").not.toContain(pty);
  });

  test("the Playwright dependency and its scripts are gone from package.json", () => {
    expect(Object.keys(packageJson.devDependencies)).not.toContain(`@play${"wright"}/test`);
    const scripts = Object.keys(packageJson.scripts);
    expect(scripts).not.toContain(`test${":"}e2e`);
    expect(scripts).not.toContain(`test${":"}e2e:ui`);
    expect(scripts).not.toContain(`test${":"}integration`);
  });
});

describe("DeadModuleResidueScan — deleted files stay deleted", () => {
  test.each([
    join("server", `pty${"-"}worker.mjs`),
    `play${"wright"}.config.ts`,
    join("e2e", `mock${"-"}session-manager.ts`),
    join("e2e"),
    join("server", `permission${"-"}bridge.ts`),
    join("server", `settings${"-"}loader.ts`),
    join("server", `tmux${"-"}control.ts`),
  ])("%s does not exist", (relative) => {
    expect(existsSync(join(repoRoot, relative))).toBe(false);
  });
});
