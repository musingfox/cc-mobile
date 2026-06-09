#!/usr/bin/env bun
/**
 * verify-e2e.ts — ADR-011 端到端 live 驗證（人類手動執行）
 *
 * 用我們實際蓋的 server/pty-reader.ts 的 runPtySession，對「真實 claude」跑一次
 * 完整的「PTY 驅動 + 讀回」迴路。這是 spike E5：自動 gate 無法驗、只有你本人在
 * 自己機器上跑才算數。
 *
 * 它會回答兩個地基問題：
 *   (1) `claude --session-id <uuid>` 是否真的把對話寫進 <uuid>.jsonl（issue #44607）
 *   (2) 真 claude 是否被 PTY 驅動、且回覆讀得回來
 *
 * 用法：
 *   bun run docs/adr/spike-011/verify-e2e.ts
 *
 * 注意：這會啟動一次真實的互動式 claude（走訂閱互動額度，非 Agent SDK credit），
 * 由你本人手動執行一次，符合 human-in-the-loop。需要 claude CLI 已登入可用。
 */
import { runPtySession } from "../../../server/pty-reader.ts";
import { homedir } from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const sessionId = randomUUID();
const cwd = process.cwd();
const prompt = "Reply with exactly one word: PONG. Do not use any tools.";

// ~/.claude/projects/<dash-encoded-cwd>/  — 編碼是把 / 換成 -
const encodedCwd = cwd.replace(/\//g, "-");
const projectDir = join(homedir(), ".claude", "projects", encodedCwd);
const expectedJsonl = join(projectDir, `${sessionId}.jsonl`);

console.log("=== ADR-011 端到端 live 驗證 ===");
console.log(`sessionId : ${sessionId}`);
console.log(`cwd       : ${cwd}`);
console.log(`預期 JSONL: ${expectedJsonl}`);
console.log(`prompt    : ${prompt}`);
console.log("");
console.log("啟動真實 claude（最多等 90 秒）...\n");

const t0 = Date.now();
try {
  const reply = await runPtySession(sessionId, cwd, prompt, { timeout: 90_000, interval: 500 });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n--- 結果（${dt}s）---`);
  console.log(`[Q2] 讀回的 assistant 回覆: ${JSON.stringify(reply)}`);
  console.log(reply ? "  → PASS：真 claude 被驅動且回覆讀得回來" : "  → 空回覆，需檢查");

  // Q1: --session-id 是否綁檔名
  if (existsSync(expectedJsonl)) {
    console.log(`[Q1] PASS：${sessionId}.jsonl 確實生成於預期路徑（--session-id 綁檔名成立）`);
  } else {
    console.log(`[Q1] FAIL：預期路徑無此檔（issue #44607 可能成立 → 讀回層需改用 PreToolUse payload 的 transcript_path）`);
    if (existsSync(projectDir)) {
      const recent = readdirSync(projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .slice(-5);
      console.log(`     projectDir 內最近的 .jsonl（claude 可能自生 UUID）: ${JSON.stringify(recent)}`);
    } else {
      console.log(`     projectDir 不存在：${projectDir}（cwd 編碼可能不符，列出 ~/.claude/projects/ 比對）`);
    }
  }
} catch (err) {
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n--- 失敗（${dt}s）---`);
  console.log(`錯誤: ${err instanceof Error ? err.message : String(err)}`);
  if (String(err).includes("timeout")) {
    console.log("  → timeout：claude 未在 90s 內寫出 end_turn。可能 (a) claude 未被 PTY 驅動、");
    console.log("    (b) JSONL 未即時 flush、(c) --session-id 未綁檔名故 poll 找錯檔。");
    console.log("    先跑下方『最小地基檢查』縮小範圍。");
  }
  if (String(err).includes("not wired") || String(err).includes("spawn")) {
    console.log("  → PTY worker 啟動問題：確認 node 與 node-pty 可用（bun run postinstall 後 spawn-helper 有執行權）。");
  }
}
