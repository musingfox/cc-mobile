/**
 * pty-worker.mjs — Node.js PTY subprocess worker for ADR-011.
 *
 * argv[2] = target binary
 * argv[3..] = args
 *
 * stdin: newline-delimited JSON {type:"write",data}
 * stdout: newline-delimited JSON {type:"data",data} or {type:"exit",code}
 *
 * This is the ONLY file permitted to top-level import node-pty.
 * It runs under Node.js, not Bun, so node-pty prebuilds are available.
 */

import { createRequire } from "module";

// node-pty ships as CommonJS; use createRequire to load it from ESM
const require = createRequire(import.meta.url);
const pty = require("node-pty");
import * as readline from "readline";

const binary = process.argv[2];
const args = process.argv.slice(3);

if (!binary) {
  process.stderr.write(JSON.stringify({ type: "error", message: "No binary specified" }) + "\n");
  process.exit(1);
}

// Spawn the target process in a PTY
const ptyProc = pty.spawn(binary, args, {
  name: "xterm-256color",
  cols: 220,
  rows: 50,
  cwd: process.cwd(),
  env: process.env,
});

// pty onData → stdout as NDJSON {type:"data",data}
ptyProc.onData((data) => {
  process.stdout.write(JSON.stringify({ type: "data", data }) + "\n");
});

// pty onExit → stdout as NDJSON {type:"exit",code}
ptyProc.onExit(({ exitCode }) => {
  process.stdout.write(JSON.stringify({ type: "exit", code: exitCode }) + "\n");
  process.exit(exitCode ?? 0);
});

// stdin: newline-delimited JSON {type:"write",data}
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    if (msg.type === "write" && typeof msg.data === "string") {
      ptyProc.write(msg.data);
    }
  } catch {
    // Ignore malformed JSON
  }
});

rl.on("close", () => {
  // stdin closed; let the pty process finish naturally
});
