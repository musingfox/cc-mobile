#!/usr/bin/env bun
/**
 * capture-tui.ts — 抓 v2.1.177 真實 TUI 輸出做新 fixture / 診斷 classify
 * 啟動真 claude（PTY），收 8 秒原始輸出，stripAnsi 後落檔，並對每秒快照跑 classify。
 */
import { defaultSpawner } from "../../../server/pty-driver";
import { stripAnsi, classify } from "../../../server/tui-readiness";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const sessionId = randomUUID();
const cwd = process.cwd();
const args = ["claude", "--session-id", sessionId];
const proc = defaultSpawner(args, cwd);

let raw = "";
if (!proc.onData) {
  console.log("ERROR: spawner 沒有 onData");
  process.exit(1);
}
proc.onData((chunk: string) => {
  raw += chunk;
});

const snapshots: { t: number; cls: string }[] = [];
for (let t = 1; t <= 8; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const stripped = stripAnsi(raw);
  snapshots.push({ t, cls: classify(stripped) });
  console.log(`t=${t}s  len=${stripped.length}  classify=${classify(stripped)}`);
}

const stripped = stripAnsi(raw);
writeFileSync("docs/adr/spike-011/tui-v2.1.177.raw.txt", raw);
writeFileSync("docs/adr/spike-011/tui-v2.1.177.stripped.txt", stripped);
console.log("\n=== stripped tail (最後 1500 字) ===");
console.log(stripped.slice(-1500));

proc.kill?.();
process.exit(0);
