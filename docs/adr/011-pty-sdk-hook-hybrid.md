# ADR-011: PTY 驅動 + SDK 唯讀 + Hook 把關的混合架構（應對 Agent SDK 計費）

## Status

Proposed — 為 [ADR-010](010-sdk-billing-response.md) 在「使用者已 STOP」後新探出的第六個方向，實質翻轉「放棄」判斷，需一個 spike 落地驗證後才拍板。

## Context

ADR-010 確認：2026-06-15 起訂閱方案的 Agent SDK / `claude -p` / 第三方 Agent SDK app 用量改吃獨立 Agent SDK credit，抽掉 cc-mobile「沿用訂閱、免額外 key」的核心價值，其列出的五個方向無一能回復經濟性。

本 ADR 探一條不在那五個之內的路徑：**不再用 SDK `query()` 驅動對話，改用 PTY 驅動互動式 `claude` TUI，SDK 僅退為唯讀中繼資料來源。** 跨四輪查證確立以下事實。

### 已確認事實（附來源，查證日期 2026-06-09）

1. **計費分桶按「呼叫管道」而非「人 vs 程式」。** 互動式 `claude` TUI 仍走訂閱互動額度（便宜桶），不吃 Agent SDK credit。計入新 credit 者明列四類：Agent SDK（Py/TS）、`claude -p`、GitHub Actions、透過訂閱授權的第三方 Agent SDK app。
   - 來源：support.claude.com/en/articles/15036540（原文「Interactive Claude Code in the terminal or IDE ... continues to use your subscription usage limits exactly as before」）

2. **結構化輸出與互動計費互斥。** `--output-format/--input-format stream-json` 文件明定為 print-mode 專用；不存在「互動計費 + 結構化串流」並存模式。故走便宜桶就拿不到 typed events，得另尋結構化來源。
   - 來源：code.claude.com/docs/en/cli-reference、.../headless、.../agent-sdk/overview

3. **互動 TUI 與 SDK 讀檔同一份 store。** 互動 session 寫進 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`，`listSessions()`/`getSessionMessages()` 讀得到（`SDKSessionInfo.customTitle` 對應 TUI 專屬 `/rename`，為鐵證）；「saved continuously as you work」可 tail。
   - 來源：code.claude.com/docs/en/sessions、.../agent-sdk/sessions、.../agent-sdk/typescript

4. **SDK 控制協定面免費。** `supportedModels()`/`supportedCommands()`/`supportedAgents()`/`mcpServerStatus()`/`accountInfo()`/`initializationResult()` 及 `listSessions()` 等檔案 helper，文件均標註「No model inference」/「does NOT spawn the model」。亦可改直接讀 `~/.claude` config（cc-mobile ADR-006 已在做）。
   - 來源：code.claude.com/docs/en/agent-sdk/typescript、.../sessions

5. **`PreToolUse` hook 是免費的結構化 permission 管道。** 互動 TUI 也觸發；為本機 shell 指令（零 token）；payload 含 `session_id`、`transcript_path`、`tool_name`、`tool_input`；可回傳 `hookSpecificOutput.permissionDecision: allow|deny|ask` 取代人在 TUI 按 y/n；同步阻塞，預設 timeout 600s（可調）。`Notification` hook 有 `permission_prompt` matcher 但僅副作用、無決策權。
   - 來源：code.claude.com/docs/en/hooks、.../hooks-guide

6. **ToS 紅線。** Consumer Terms §3(7) 禁止「automated or non-human means, whether through a bot, script, or otherwise」存取 Services，豁免僅給 Anthropic API Key。PTY 自動驅動互動 TUI 落入此條；唯有嚴格 human-in-the-loop（人逐次決策、軟體僅轉送鍵盤，類 ttyd/wetty）可辯護，任何自主驅動（自動核准、排程、agent loop）即明確違反。
   - 來源：anthropic.com/legal/consumer-terms §3(7)

### 未確認事項（needs spike）

- hook 在實際安裝版本的 `permissionDecision` 行為是否如文件。
- JSONL flush 顆粒度（每個 tool_use 是否逐筆即時落檔，影響 tail 近即時性）。
- 互動模式 `--session-id` 是否真不綁持久化檔名（issue #44607）；若是，改以 `PreToolUse` payload 的 `session_id`/`transcript_path` 取得綁定。
- pending permission 暫態是否入 JSONL（推測否，故依賴 `PreToolUse` 而非 tail）。

## 架構

| 層 | 機制 | 計費 | 結構化 |
|---|---|---|---|
| 驅動／送指令 | PTY → 互動 TUI | 訂閱互動桶 | keystroke |
| 能力（commands/agents/MCP/models） | SDK control methods 或讀 `~/.claude` config | 免費 | 是 |
| 即時對話紀錄 | tail JSONL | 免費 | 是（flush 顆粒待測） |
| permission / tool 把關 | `PreToolUse` hook → 推手機 → 阻塞等點選 → 回傳 allow/deny | 免費 | 是 |
| 通知（idle、permission_prompt） | `Notification` hook | 免費 | 是（僅副作用） |

### 對既有 ADR 的對照

搬移既有已驗證模式，非重新發明：

- ADR-002 permission bridge（`canUseTool` 阻塞 + 推手機 + 60s timeout）→ `PreToolUse` hook（同形，timeout 600s）
- ADR-006 plugin/command 探索（讀 `~/.claude`）→ 不變
- ADR-007 typed stream events（`query()`）→ tail JSONL + hook 事件
- 唯一換掉：`query()` 驅動 → PTY keystroke 注入

## 後果

### 開啟的門

- 回復「沿用訂閱、免額外 API key」核心價值，driving 落便宜的互動桶。
- 保留 plugin / skill / slash command / agent 的觸控 UX 賣點（能力層免費結構化）。
- permission 與 session 綁定問題由 `PreToolUse` hook 一併解決。

### 關閉的門 / 代價（無法以技術消除）

1. **ToS 姿態約束**：送 prompt 仍走 PTY，落 §3(7) 範圍。產品必須守住「純 human-in-the-loop、不自主驅動」這條線；一旦加自動核准／排程／agent loop 即違反。屬政策決定，非技術缺口。Anthropic 亦可隨時加條款或技術偵測 reclassify。
2. **工程面變大**：從「單一 SDK 整合」變「PTY + hook endpoint + JSONL tailer + config reader」四件，且各有版本相依的暫態行為需先 spike 釘死。

## 落地前 Spike 清單（半天，先驗證再投入）

- [ ] `claude --session-id $UUID` 跑互動，確認 `$UUID.jsonl` 是否生成（驗 issue #44607）。
- [ ] 配 `PreToolUse` hook，確認互動模式觸發、payload 帶 `session_id`/`transcript_path`、`permissionDecision: deny` 確實擋下 tool。
- [ ] hook 阻塞 N 秒再回傳，確認 claude 等待且決策生效；量測可用 timeout 上限。
- [ ] 互動 session 進行中 tail 對應 JSONL，量 flush 近即時性與 tool_use 落檔顆粒。
- [ ] 確認 pending permission 暫態是否入 JSONL（決定 UI 即時狀態靠 hook 還是 tail）。

## 決策

**需人工決策**：是否接受「more 工程面 + 一條靠紀律守住的 ToS 紅線」換回核心經濟性與 UX。建議先跑上方 spike，全綠才將本 ADR 由 Proposed 轉 Accepted 並重啟專案。
