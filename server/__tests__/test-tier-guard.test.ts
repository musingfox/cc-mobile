/**
 * test-tier-guard.test.ts — the commit gate's check of
 * docs/spec/test-tier-by-dependency.md: no test that `bun test` collects may
 * spawn a process, bind a fixed port, or write outside tmpdir().
 *
 * The walk reproduces Bun's documented discovery — the `.test` / `_test` /
 * `.spec` / `_spec` name forms, `node_modules` and dot-directories skipped —
 * minus bunfig.toml's `pathIgnorePatterns`, so a test moved out of the gate
 * drops out of this scan by the same rule that drops it from the run. Helper
 * modules a test imports are not collected, so they are not scanned either.
 *
 * Each file is scanned after Bun.Transpiler has stripped its comments and
 * types: prose naming a forbidden call is not a hit, and this file is scanned
 * like every other one, with no exemption.
 *
 * The scan is static and follows a path only through bindings in the same
 * file; the spec states what that reaches and what it does not.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const selfPath = relative(repoRoot, import.meta.path)
  .split(sep)
  .join("/");

// ---- The walk: what `bun test` collects -----------------------------------------------

const TEST_FILE_NAME = /[._](test|spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;

const bunfig = Bun.TOML.parse(readFileSync(join(repoRoot, "bunfig.toml"), "utf8")) as {
  test?: { pathIgnorePatterns?: string | string[] };
};
const ignored = [bunfig.test?.pathIgnorePatterns ?? []].flat().map((p) => new Bun.Glob(p));

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) collect(full, out);
      continue;
    }
    const path = relative(repoRoot, full).split(sep).join("/");
    if (TEST_FILE_NAME.test(entry.name) && !ignored.some((glob) => glob.match(path))) {
      out.push(path);
    }
  }
  return out;
}

const LOADERS = {
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
  ts: "ts",
  mts: "ts",
  cts: "ts",
  tsx: "tsx",
} as const;

interface Scanned {
  path: string;
  code: string;
  imports: string[];
}

const scanned: Scanned[] = collect(repoRoot).map((path) => {
  const source = readFileSync(join(repoRoot, path), "utf8");
  const ext = path.slice(path.lastIndexOf(".") + 1) as keyof typeof LOADERS;
  const transpiler = new Bun.Transpiler({ loader: LOADERS[ext] });
  return {
    path,
    code: transpiler.transformSync(source),
    imports: transpiler.scan(source).imports.map((i) => i.path),
  };
});

// ---- Reading expressions out of transpiled code -----------------------------------------

/**
 * Index of the first character in `stops` at bracket depth zero, or of the
 * bracket that closes one enclosing `from`. String contents are skipped.
 */
function scanTo(code: string, from: number, stops: string): number {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = stringEnd(code, i);
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && stops.includes(ch)) {
      return i;
    }
  }
  return code.length;
}

function stringEnd(code: string, from: number): number {
  const quote = code[from];
  for (let i = from + 1; i < code.length; i++) {
    const ch = code[i];
    if (ch === "\\") {
      i++;
    } else if (quote === "`" && ch === "$" && code[i + 1] === "{") {
      i = scanTo(code, i + 2, "");
    } else if (ch === quote) {
      return i;
    } else if (ch === "\n" && quote !== "`") {
      // A quote inside a regex literal opens no string; contain the misread to its line.
      return i;
    }
  }
  return code.length;
}

/** Top-level argument texts of the call whose `(` is at `open`. */
function callArgs(code: string, open: number): string[] {
  const args: string[] = [];
  let i = open + 1;
  for (;;) {
    const end = scanTo(code, i, ",");
    const text = code.slice(i, end).trim();
    if (text) args.push(text);
    if (code[end] !== ",") return args;
    i = end + 1;
  }
}

function callSites(code: string, callee: RegExp): Array<{ at: number; args: string[] }> {
  return [...code.matchAll(callee)].map((m) => {
    const at = m.index ?? 0;
    return { at, args: callArgs(code, at + m[0].length - 1) };
  });
}

interface Binding {
  at: number;
  rhs: string;
}

/**
 * Every `name = <expr>` in the file, declaration or assignment, by name. Loop
 * variables and function parameters are recorded with an empty right-hand
 * side: they hide an outer binding of the same name, and their value is
 * unknown here.
 */
function bindingsOf(code: string): Map<string, Binding[]> {
  const bindings = new Map<string, Binding[]>();
  const bind = (name: string, at: number, rhs: string) =>
    bindings.set(name, [...(bindings.get(name) ?? []), { at, rhs }]);

  for (const m of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) {
    const at = m.index ?? 0;
    const start = at + m[0].length;
    // The transpiler prints one statement per line, so a top-level newline ends it.
    bind(m[1], at, code.slice(start, scanTo(code, start, ",;\n")).trim());
  }
  for (const m of code.matchAll(
    /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g,
  )) {
    bind(m[1], m.index ?? 0, "");
  }
  const parameterLists = [
    /\bfunction\b\s*\*?\s*[\w$]*\s*\(([^)]*)\)/g,
    /\(([^()]*)\)\s*=>/g,
    /(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g,
  ];
  for (const re of parameterLists) {
    for (const m of code.matchAll(re)) {
      for (const piece of m[1].split(",")) {
        const name = piece.match(/^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(?:=|$)/)?.[1];
        if (name) bind(name, m.index ?? 0, "");
      }
    }
  }
  for (const list of bindings.values()) list.sort((a, b) => a.at - b.at);
  return bindings;
}

/** The binding in force at `at`: the nearest one before it, else all of them. */
function bindingsAt(bindings: Map<string, Binding[]>, name: string, at: number): Binding[] {
  const list = bindings.get(name) ?? [];
  const before = list.filter((b) => b.at < at);
  return before.length > 0 ? [before[before.length - 1]] : list;
}

/** The expression plus what its identifiers are bound to, a few levels deep. */
function expanded(expr: string, at: number, bindings: Map<string, Binding[]>, depth = 3): string[] {
  if (depth === 0) return [expr];
  const names = [...expr.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)].map(([name]) => name);
  return [
    expr,
    ...names.flatMap((name) =>
      bindingsAt(bindings, name, at).flatMap((b) => expanded(b.rhs, b.at, bindings, depth - 1)),
    ),
  ];
}

/**
 * What a path expression is rooted at: through path-building calls to their
 * first argument, through a leading template interpolation, and through an
 * identifier to what it is bound to. An unresolvable root (a parameter, a
 * property) comes back as itself.
 */
function rootsOf(expr: string, at: number, bindings: Map<string, Binding[]>, depth = 4): string[] {
  const e = expr.trim().replace(/^await\s+/, "");
  const wrapper = e.match(
    /^(?:[\w$]+\.)*(?:join|resolve|normalize|dirname|realpathSync|realpath|mkdtempSync|mkdtemp|file)\s*\(/,
  );
  if (wrapper) {
    const start = wrapper[0].length;
    return rootsOf(e.slice(start, scanTo(e, start, ",")), at, bindings, depth);
  }
  if (e.startsWith("`${")) {
    return rootsOf(e.slice(3, scanTo(e, 3, "")), at, bindings, depth);
  }
  const homeDefault = e.match(/^([\w$]+)\s*\(/);
  if (homeDefault && homeDefault[1] in HOME_DEFAULT_PATHS) {
    const args = callArgs(e, homeDefault[0].length - 1);
    const rootArg = args[HOME_DEFAULT_PATHS[homeDefault[1]]];
    return rootArg === undefined ? ["homedir()"] : rootsOf(rootArg, at, bindings, depth);
  }
  if (depth > 0 && /^[A-Za-z_$][\w$]*$/.test(e)) {
    const bound = bindingsAt(bindings, e, at);
    if (bound.length > 0) return bound.flatMap((b) => rootsOf(b.rhs, b.at, bindings, depth - 1));
  }
  return [e];
}

// ---- Spawning a process ---------------------------------------------------------------

function spawnHits(file: Scanned): string[] {
  const hits: string[] = [];
  if (/\bBun\s*\.\s*spawn(Sync)?\s*\(/.test(file.code)) hits.push("calls Bun.spawn");
  if (/\bBun\s*\.\s*\$\s*`/.test(file.code)) hits.push("runs a Bun shell command");
  if (/import\s*\{[^}]*(?<![\w$])\$(?![\w$])[^}]*\}\s*from\s*["']bun["']/.test(file.code)) {
    hits.push("imports the Bun shell");
  }
  for (const path of file.imports) {
    if (/^(node:)?child_process$/.test(path)) hits.push(`imports ${path}`);
  }
  return hits;
}

// ---- Binding a fixed port -------------------------------------------------------------

const NONZERO_LITERAL = /^["'`]?[1-9]\d*/;
const NONZERO_PORT_KEY = /\bport\s*:\s*["'`]?[1-9]\d*/;

function portHits(file: Scanned): string[] {
  const bindings = bindingsOf(file.code);
  const hits: string[] = [];
  for (const { at, args } of callSites(file.code, /\.\s*listen\s*\(/g)) {
    const seen = args[0] === undefined ? [] : expanded(args[0], at, bindings);
    if (seen.some((t) => NONZERO_LITERAL.test(t) || NONZERO_PORT_KEY.test(t))) {
      hits.push(`listens on a fixed port: ${args[0]}`);
    }
  }
  for (const { at, args } of callSites(file.code, /\bBun\s*\.\s*serve\s*\(/g)) {
    const seen = args[0] === undefined ? [] : expanded(args[0], at, bindings);
    // Without a port, Bun.serve binds $BUN_PORT, $PORT, $NODE_PORT or 3000.
    const namesPort = seen.some((t) => /\b(port|unix)\s*:/.test(t));
    if (!namesPort || seen.some((t) => NONZERO_PORT_KEY.test(t))) {
      hits.push(`serves on a fixed port: Bun.serve options ${args[0] ?? "(none)"}`);
    }
  }
  return hits;
}

// ---- Writing outside tmpdir() ---------------------------------------------------------

/** Filesystem calls that change the disk, and which arguments name what they change. */
const WRITERS: Record<string, number[]> = {
  writeFileSync: [0],
  writeFile: [0],
  appendFileSync: [0],
  appendFile: [0],
  mkdirSync: [0],
  mkdir: [0],
  mkdtempSync: [0],
  mkdtemp: [0],
  rmSync: [0],
  rm: [0],
  rmdirSync: [0],
  rmdir: [0],
  unlinkSync: [0],
  unlink: [0],
  chmodSync: [0],
  chmod: [0],
  truncateSync: [0],
  truncate: [0],
  utimesSync: [0],
  utimes: [0],
  createWriteStream: [0],
  copyFileSync: [1],
  copyFile: [1],
  cpSync: [1],
  cp: [1],
  symlinkSync: [1],
  symlink: [1],
  linkSync: [1],
  link: [1],
  renameSync: [0, 1],
  rename: [0, 1],
};

/**
 * Production functions that write under the developer's home directory when
 * their root parameter is omitted, mapped to that parameter's position.
 */
const HOME_DEFAULT_WRITERS: Record<string, number> = {
  createUploadPlugin: 1,
  createUploadImagePlugin: 1,
  ensureUploadDir: 1,
  cleanupUploads: 1,
};

/** Production functions that return a path under the home directory unless given a root. */
const HOME_DEFAULT_PATHS: Record<string, number> = {
  getUploadDir: 1,
  safeSessionDir: 1,
};

const OUTSIDE_TMPDIR = [
  /\bimport\.meta\b/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\bprocess\.cwd\s*\(/,
  /\bhomedir\s*\(/,
  /\bprocess\.env\.HOME\b/,
];

function rootedOutsideTmpdir(root: string): boolean {
  const literal = /^["']/.test(root) || (root.startsWith("`") && !root.startsWith("`${"));
  return literal || OUTSIDE_TMPDIR.some((re) => re.test(root));
}

/** Callee patterns for the WRITERS this file imports from `fs` or `fs/promises`. */
function fsWriterCallees(code: string): Array<{ callee: RegExp; name: string }> {
  const callees: Array<{ callee: RegExp; name: string }> = [];
  const fsImport =
    /import\s*([A-Za-z_$][\w$]*)?\s*,?\s*(?:\*\s*as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/g;
  for (const m of code.matchAll(fsImport)) {
    const namespaces = [m[1], m[2]].filter((n): n is string => Boolean(n));
    for (const spec of (m[3] ?? "").split(",")) {
      const [orig, local = orig] = spec.trim().split(/\s+as\s+/);
      if (orig === "promises") namespaces.push(local);
      else if (orig && orig in WRITERS) {
        callees.push({ callee: new RegExp(`(?<![\\w$.])${local}\\s*\\(`, "g"), name: orig });
      }
    }
    for (const ns of namespaces) {
      for (const name of Object.keys(WRITERS)) {
        const member = `(?<![\\w$.])${ns}\\s*\\.\\s*(?:promises\\s*\\.\\s*)?${name}\\s*\\(`;
        callees.push({ callee: new RegExp(member, "g"), name });
      }
    }
  }
  return callees;
}

function writeHits(file: Scanned): string[] {
  const bindings = bindingsOf(file.code);
  const hits: string[] = [];
  const direct = [
    ...fsWriterCallees(file.code),
    { callee: /\bBun\s*\.\s*write\s*\(/g, name: "Bun.write" },
  ];
  for (const { callee, name } of direct) {
    for (const { at, args } of callSites(file.code, callee)) {
      for (const position of WRITERS[name] ?? [0]) {
        const arg = args[position];
        if (arg === undefined) continue;
        const outside = rootsOf(arg, at, bindings).filter(rootedOutsideTmpdir);
        if (outside.length > 0) hits.push(`${name}(${arg}) is rooted at ${outside.join(" | ")}`);
      }
    }
  }
  for (const [name, rootPosition] of Object.entries(HOME_DEFAULT_WRITERS)) {
    for (const { args } of callSites(file.code, new RegExp(`(?<![\\w$.])${name}\\s*\\(`, "g"))) {
      if (args.length <= rootPosition) {
        hits.push(`${name}(${args.join(", ")}) writes to its home-directory default`);
      }
    }
  }
  return hits;
}

// ---- Assertions ---------------------------------------------------------------------

function report(check: (file: Scanned) => string[]): string[] {
  return scanned.flatMap((file) => check(file).map((hit) => `${file.path}: ${hit}`));
}

describe("TestTierGuard — the walk matches what bun test collects", () => {
  test("it collects this file, so it walks where bun test walks", () => {
    expect(scanned.map((f) => f.path)).toContain(selfPath);
  });

  test("it drops what bunfig.toml's pathIgnorePatterns drops", () => {
    const outOfGate = "client/integration/pwa-build.test.ts";
    expect(existsSync(join(repoRoot, outOfGate))).toBe(true);
    expect(scanned.map((f) => f.path)).not.toContain(outOfGate);
  });
});

describe("TestTierGuard — the unit tier's forbidden dependencies", () => {
  test("no collected test spawns a process", () => {
    expect(report(spawnHits)).toEqual([]);
  });

  test("no collected test binds a fixed port", () => {
    expect(report(portHits)).toEqual([]);
  });

  test("no collected test writes outside tmpdir()", () => {
    expect(report(writeHits)).toEqual([]);
  });
});
