/**
 * dead-code-residue.test.ts — DeadModuleResidueScan and DeadHistoryPathResidueScan.
 *
 * #25 deleted three whole paths (SDK query, the PTY one-shot chain, the tmux
 * adapter) plus the Playwright suite; #26 deleted the browse-past-conversations
 * path on top of them. This scan is the guard that stops any of them creeping
 * back in via a stray import or a re-added script: every pattern below must
 * have zero hits across `server/` and `client/`.
 *
 * Patterns are assembled from fragments so this file does not match itself.
 * `docs/` is deliberately out of scope — the ADRs and spike logs describe what
 * was deleted and are supposed to keep saying so.
 *
 * Two files are excluded by name: this one, and the retired-message protocol
 * test, which has to spell the dead message names out in order to assert that
 * the schema refuses them.
 *
 * StreamEventPipelineResidueScan covers the client's SDK-era chunk pipeline,
 * which the server stopped feeding at #25. Two of its patterns are narrower
 * than the rest, on purpose: `stream_event` is scanned in production files
 * only, because tests still feed it as a chunk the client must ignore; and
 * `currentStreamMessageId` is allowed exactly once, in the loader that strips
 * it from blobs older bundles left in localStorage. The exception is named
 * here rather than hidden by splitting the identifier at its use site.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const scanRoots = ["server", "client"].map((d) => join(repoRoot, d));

const EXCLUDED_FILES = new Set(["dead-code-residue.test.ts", "protocol-retired-messages.test.ts"]);

function collectSourceFiles(
  dir: string,
  out: string[] = [],
  extensions: string[] = [".ts", ".tsx"],
): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      collectSourceFiles(full, out, extensions);
      continue;
    }
    if (!extensions.some((extension) => entry.endsWith(extension))) continue;
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

function isProduction(path: string): boolean {
  return !path.includes(".test.") && !path.includes("__tests__");
}

const stylesheets = (() => {
  const files = collectSourceFiles(join(repoRoot, "client"), [], [".css"]);
  if (files.length === 0) throw new Error("scan found no stylesheets");
  return files.map((path) => ({
    path: path.slice(repoRoot.length + 1),
    text: readFileSync(path, "utf8"),
  }));
})();

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
    // browse-past-conversations modules and the type they spoke
    `session${"-"}listing`,
    `session${"-"}history`,
    `Session${"List"}Item`,
    // The guard the deleted permission bridge put ahead of every WS case.
    `No permission ${"handler"}`,
    // #29: the self-built hook pipeline. Replies come from the transcript and
    // permissions from the pane's screen, so nothing may reach for a hook again.
    `pty${"-"}stop-hook`,
    `pty${"-"}permission-hook`,
    `pty${"-"}response-relay`,
    `pty${"-"}permission-relay`,
    `pty${"-"}response-endpoint`,
    `pty${"-"}permission-endpoint`,
    `claude${"-"}settings`,
    `build${"Claude"}Settings`,
    // Disk capabilities cache (writerless since #25) and the open-path emitter.
    `capabilities${"-"}cache`,
    `load${"Cached"}Capabilities`,
    `emit${"Capabilities"}OnOpen`,
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
    // #26: the browse-past-conversations names, client→server then server→client.
    `list${"_"}sessions`, // note: `list_terminal_sessions` does not contain this
    `resume${"_"}session`,
    `set${"_"}session_title`,
    `session${"_"}list`,
    `session${"_"}history`,
    // Accepted but inert since #25, then removed end to end.
    `stop${"_"}task`,
    `append${"_"}user_message`,
    // `session_created` is deliberately NOT scanned for the same reason as
    // `new_session` below: it is an ordinary payload name that appears as a
    // debug-log sample. Its refusal is proved at the schema level instead.
    // `new_session` / `send` / `command` are deliberately NOT scanned: they are
    // ordinary English words that appear as debug-log payloads and in prose,
    // and the schema-level proof that they are refused lives in
    // protocol-retired-messages.test.ts.
  ];

  test.each(retiredNames)("no source file mentions %s", (pattern) => {
    expect(hits(pattern)).toEqual([]);
  });
});

describe("DeadModuleResidueScan — cleared follow-up markers", () => {
  test("no source file carries a #25 follow-up marker", () => {
    // Every one pointed at an inert path #25 left behind, and those are gone.
    // New debt gets its own ticket rather than reviving a closed one's tag.
    expect(hits(`25${"-"}followup`)).toEqual([]);
  });
});

describe("DeadModuleResidueScan — refusals that must not exist", () => {
  test("no code refuses a prompt because a pane runs without a permission gate", () => {
    // The human gate ruled that a `bypassPermissions` pane is drivable and
    // merely flagged (Decision H4). A refusal code for it must never appear:
    // the badge is the whole obligation, and a second rule pointing the other
    // way would silently win.
    expect(hits(`session${"_"}ungated`)).toEqual([]);
  });
});

describe("DeadModuleResidueScan — dependency surface", () => {
  test("no production file imports the agent SDK any more", () => {
    const sdk = `@anthropic-ai/claude${"-"}agent-sdk`;
    // The last two importers were the session listing and history readers,
    // deleted with the browse-past-conversations path.
    const production = hits(sdk).filter((p) => !p.includes(".test.") && !p.includes("__tests__"));
    expect(production.sort()).toEqual([]);
  });

  test("the agent SDK dependency is gone from package.json", () => {
    const sdk = `@anthropic-ai/claude${"-"}agent-sdk`;
    expect(Object.keys(packageJson.dependencies)).not.toContain(sdk);
    expect(Object.keys(packageJson.devDependencies)).not.toContain(sdk);
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
    join("server", `session${"-"}listing.ts`),
    join("server", `session${"-"}history.ts`),
    join("server", `capabilities${"-"}cache.ts`),
    join("server", `capabilities${"-"}cache.test.ts`),
  ])("%s does not exist", (relative) => {
    expect(existsSync(join(repoRoot, relative))).toBe(false);
  });
});

describe("StreamEventPipelineResidueScan", () => {
  const deletedIdentifiers = [
    // The chunk type-guard module, and the guards it exported.
    `tool${"-"}events`,
    `is${"Task"}Started`,
    `is${"Task"}Progress`,
    `is${"Task"}Notification`,
    `is${"Hook"}Started`,
    `is${"Hook"}Response`,
    `is${"Prompt"}Suggestion`,
    `is${"Api"}Retry`,
    `is${"SessionState"}Changed`,
    `is${"Memory"}Recall`,
    `is${"Compact"}Boundary`,
    `is${"Permission"}Denied`,
    `Terminal${"Reason"}`,
    // ws-service's handlers for those chunks.
    `handle${"MemoryRecall"}Chunk`,
    `handle${"PermissionDenied"}Chunk`,
    `handle${"ApiRetry"}Chunk`,
    `handle${"Notification"}Chunk`,
    `handle${"CompactBoundary"}Chunk`,
    `get${"TerminalReason"}Message`,
    `derive${"Context"}Usage`,
    `MAX_TOKENS${"_"}FALLBACK`,
    `resolve${"Agent"}Attribution`,
    // The streaming bubble and the renderer's fast path for it.
    `start${"Stream"}Message`,
    `appendToLast${"Assistant"}Message`,
    `STREAM_RENDER${"_"}INTERVAL`,
    `skip${"Enhancements"}`,
    // The unmounted AskUserQuestion island.
    `AskUserQuestion${"UI"}`,
    `Question${"Stepper"}`,
    `Option${"Button"}`,
  ];

  test.each(deletedIdentifiers)("no source file references %s", (pattern) => {
    expect(hits(pattern)).toEqual([]);
  });

  test.each([
    `lin${"-"}caret`,
    `lin-thinking${"--"}streaming`,
    `lin-tool-card${"-"}agent`,
  ])("no stylesheet defines %s", (pattern) => {
    expect(stylesheets.filter((f) => f.text.includes(pattern)).map((f) => f.path)).toEqual([]);
  });

  test("no production file names the stream_event chunk", () => {
    expect(hits(`stream${"_"}event`).filter(isProduction)).toEqual([]);
  });

  test("the retired bubble id survives only as the field the loader strips", () => {
    const field = `current${"StreamMessage"}Id`;
    const production = hits(field).filter(isProduction);
    expect(production).toEqual([join("client", "services", "session-persistence.ts")]);
    const loader = sourceFiles.find((f) => f.path === production[0])?.text ?? "";
    expect(loader.split(field).length - 1).toBe(1);
    expect(loader).toContain(`Reflect.deleteProperty(parsed as object, "${field}")`);
  });

  test.each([
    join("client", "services", `tool${"-"}events.ts`),
    join("client", "components", `AskUserQuestion${"UI"}.tsx`),
    join("client", "components", `Question${"Stepper"}.tsx`),
    join("client", "components", `Option${"Button"}.tsx`),
    join("client", "components", "linear", `ask${"-"}question.css`),
    join("tests", `contracts${".test"}.ts`),
  ])("%s does not exist", (relative) => {
    expect(existsSync(join(repoRoot, relative))).toBe(false);
  });
});
