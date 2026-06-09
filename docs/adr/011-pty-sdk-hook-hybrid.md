# ADR-011: PTY 驅動 + SDK 唯讀 + Hook 把關的混合架構（應對 Agent SDK 計費）

## Status

**Accepted（2026-06-09）** — 兩個技術地基已 live 實證通過、核心元件已實作（13 輪 /spiral，commits `2e8b6e7`…`c2ed02d`）。混合架構方向確立。**但有一個尚未拍板的架構子決策（session 生命週期模型，見文末）與兩道非技術的門（ToS §3(7) 政策、經濟性待 2026-06-15）。**

前身為 [ADR-010](010-sdk-billing-response.md) 在「使用者已 STOP」後新探出的第六個方向，實質翻轉「放棄」判斷。

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

### 未確認事項 → 已實證（2026-06-09 live 驗證，claude v2.1.169 / macOS）

- ✅ **`--session-id` 綁持久化檔名**：`claude --session-id $UUID` 互動跑確實生成 `$UUID.jsonl`（issue #44607 在此版本不適用，讀回地基成立）。工具：`docs/adr/spike-011/verify-e2e.ts`。
- ✅ **PreToolUse hook 在互動模式觸發 + payload + deny**：hook 確實被呼叫、payload 含 `session_id`/`transcript_path`/`tool_name`/`tool_input`/`tool_use_id`、`permissionDecision:"deny"` 確實擋下工具（claude 畫面顯示被攔截、工具未執行）。**`session_id` = `--session-id` = jsonl 檔名（三者同一，permission 綁回 session 成立）**。工具：`docs/adr/spike-011/verify-hook.sh`。官方 hook 格式：`hookSpecificOutput.{hookEventName(必填), permissionDecision: allow|deny|ask|defer}`；專案層 `.claude/settings.json` hook 自動執行（無個人審核）。
- ⏳ **JSONL flush 顆粒度 / pending permission 暫態**：端到端 verify-e2e 4.5s 完成證明 flush 夠即時可用；pending permission 改由 `PreToolUse` hook 即時取得（不依賴 tail），故此項已不在關鍵路徑。

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

## 實作與實證（2026-06-09，13 輪 /spiral）

每輪皆獨立 Divergence 審查 + 確定性 gate（mock/fixture，不驅動 claude）把關。commits `2e8b6e7`…`c2ed02d`。

**已建元件（server/）**
- **PTY transport**：`pty-worker.mjs`（Node worker 跑 node-pty——因 node-pty 的 libuv callback 在 Bun 下靜默失效，故拆 Node 子行程，stdio NDJSON 橋接）+ `pty-driver.ts`（SpawnerFn 抽象 + onData）+ `pty-reader.ts`（`runPtySession`：驅動 + 讀回 JSONL）。
- **TUI readiness 驅動**（`tui-readiness.ts`）：盲打不行——互動 TUI 初始化要數秒、新資料夾先跳 trust 對話框。改為讀 PTY 輸出 → settle 後 classify（trust 對話框 vs 輸入框 ready，用錨定片語）→ trust 送確認、ready 才送 prompt。
- **ws.ts 整合**：additive `pty_send` 訊息 + `PtyOrchestrator`（per-session 生命週期、kill handle、cwd 沙箱驗證、sessionId UUID 驗證）。不拆既有 `query()` 路徑。
- **permission bridge P2**：`pty-permission-relay.ts`（promise + 600s timeout + pause/resume）+ `pty-permission-endpoint.ts`（`POST /api/pty-permission`）+ `pty-permission-hook.ts`（hook script：POST payload → 阻塞 → 輸出 `permissionDecision`）。重用既有 `permission_request`/`permission` WS schema，**零對外協定變更、client 不動**。

**兩個地基 live 實證 PASS**（見上「已實證」）：① PTY 驅動 + JSONL 讀回（verify-e2e 4.5s）；② PreToolUse hook permission（spike A2/A3）。架構技術可行性成立。

## 尚未拍板：session 生命週期模型（架構子決策）

turn-13 Divergence 揭露：上述驅動是「**一次性** prompt → poll 等 end_turn → 完成」模型，**撐不住「長壽互動 session」**——而那正是真正可用的產品所需：

- **permission 等待 vs poll timeout**：claude 卡著等使用者在手機核准工具（可達數分鐘）時不產生 end_turn → `runPtySession` 的 poll 預設 60s timeout → 刪掉 orchestrator session → 核准永遠完不成（relay 的 600s timeout 反而到不了）。
- **斷線 vs session 存活**：手機息屏/PWA 背景/切 tab 會斷 WS；目前 `close()` 的 `cancelAll` 直接殺 claude 行程 → 為撐斷線而建的 relay pause/resume 形同虛設（重連後 claude 已死）。

**需決定的設計方向**（任一前須先定）：
1. session 模型：維持一次性 drive，還是改長壽互動 session（撐工具核准等待 + 撐斷線重連）？
2. poll 與 permission-pending 協調：permission 進行中時 poll 不可 timeout 刪 session。
3. 斷線策略：保留 claude 行程（不 cancelAll）+ 孤兒 reaper，或接受「斷線＝session 結束」。

## 決策

- **技術可行性**：✅ 已實證（兩地基 PASS + P2 核心建成）。混合架構 **Accepted**。
- **session 生命週期模型**：⏳ 需人工拍板（見上），是讓 P2 真正端到端 work 的前置。
- **ToS §3(7)**：產品須守「純 human-in-the-loop、不自主驅動」這條政策線（無法以技術消除；Anthropic 可隨時 reclassify）。
- **經濟性**：✅ 技術跑得起來，但**划不划算**須待 2026-06-15 計費新規生效後，於互動模式實際量測訂閱桶用量才能定（與技術可行性是兩回事）。

**端到端 live（EX-11，待使用者配合真 claude + 手機 client）**：真 claude → hook → server → 手機核准 → 回 hook 的完整迴路；須在 session 模型拍板、H2-B/H1-C 解掉後再跑（否則 60s 即逾時）。
