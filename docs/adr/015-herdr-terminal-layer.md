# ADR-015: herdr 取代 tmux 作為持久化終端層

## Status

Accepted（2026-07-31）

## Context

### 背景

ADR-014 拍板採用 C-hybrid（cc-mobile 擁有 tmux session），讓桌機可 `tmux attach` 取得原生體驗，手機走 hook 結構化路徑。現行實作以 tmux CLI 作為持久化終端層，session 僅存於記憶體 Map（tmux-registry.ts:144），server 重啟即失聯。後續需更穩定的持久化多工層。

本 ADR 決策以 herdr socket API 取代 tmux CLI 作為持久化終端層，C-hybrid 擁有權模型保留。

### 已確認事實（查證日期：2026-07-31）

- herdr 0.7.5 已裝、daemon 運行中；herdr 使用 JSON-RPC over unix socket（預設 `~/.config/herdr/herdr.sock`）。
- Anthropic 2026-06-15 當日公告暫停 Agent SDK 使用限制 enforcement（「For now, nothing has changed.」，無重啟時程；來源：support.claude.com/en/articles/15036540、thenewstack/the-decoder 報導）。
- billable SDK query() 路徑目前從 mobile UI 不可達（client send()/sendCommand() 無呼叫點，UI 唯一活路徑 pty_send → PTY one-shot）。此路徑涉及 session-manager.ts 與 SDK resume 邏輯。
- 現行 tmux 實作細節（包含 tmux-registry.ts 的 in-memory sessions）將被 herdr 取代，SDK query() 驅動路徑刪除範圍見 #25；herdr 驅動互動 TUI 落 cli 訂閱互動桶，計費風險自然消解。
  - **2026-08-02 更新**：#25 已完成。SDK query() 路徑、PTY one-shot 鏈與 tmux adapter 全數刪除，`tmux_*` 訊息更名 `terminal_*`。實際刪除清單見 [ADR-011 module inventory](011-module-inventory.md) 文末的「#25 後現況」節。

### herdr socket API 契約摘要

herdr 提供以下主要 API（JSON-RPC）：

- `session.snapshot`
- `pane.send_text`
- `pane.send_keys`
- `pane.read`
- `events.subscribe`（含 `pane.agent_status_changed`）

另有 CLI 指令 `herdr agent attach`（非 socket API 方法），供桌機接手 session 使用。

`AgentInfo` 內建欄位：
- `agent_status`
- `agent_session`（對映 claude session id，可用於 resume）
- `interactive_ready`
- `cwd`

`agent_session` 提供 claude session id 的 resume 對映，支援 `resume` 語義。

C-hybrid 概念保留：cc-mobile 擁有 session，桌機以 `herdr agent attach` 接手（取代 `tmux attach`）。

## 決策

採用 herdr socket API 取代 tmux CLI 作為 cc-mobile 的持久化終端層。

- 所有終端操作透過 `~/.config/herdr/herdr.sock` 的 JSON-RPC 進行。
- 保留 C-hybrid 擁有權：cc-mobile 建立並擁有 herdr session，claude 於其中執行。
- 桌機接手改用 `herdr agent attach`。
- SDK query() 驅動路徑移除（明文 defer 至 #25）。
- 互動 TUI 仍走訂閱互動桶，符合現行計費模型。
- 本決策不依賴 Anthropic 目前暫停 Agent SDK 使用限制 enforcement 的政策態勢成立（該暫停可隨時撤回）；即使 enforcement 恢復，單一 herdr 主幹與 SDK query() 路徑刪除的決策仍然成立。

此決策不改程式碼，實作於後續 #20-#25。

## 風險

- herdr 0.x 版本穩定性未知，可能隨版本演進有 breaking change。
- 單一 daemon 依賴：herdr daemon 故障將影響所有 session。
- 與 tmux 相比，herdr 的成熟度與社群支援較低。

## 與既有 ADR 的關係

本 ADR 取代 ADR-014 中 tmux 的具體實作選擇，C-hybrid 概念由本 ADR 承接。

### ADR-014（Terminal ↔ cc-mobile 即時共享架構決策）
承接 ADR-014 的四個核心概念：
- C-hybrid 擁有權模型（cc-mobile 擁有 session，使用者以 agent attach 接手）。
- hook 讀回複用 ADR-011 的機制。
- smallest-client-wins 迴避理由（手機不渲染 raw terminal）。
- C1/C2 排除理由（C1 部署摩擦與控制分裂、C2 需重寫 raw PTY）。

### ADR-013（Session 生命週期模型）
長存 session 由 ADR-015 承接，one-shot 模型引用需更新以反映 herdr 持久化層。

### ADR-012（Zellij 整合可行性）
tmux 選擇被 herdr 取代，zellij 相關評估維持。

### ADR-011（PTY + hook 混合架構）
hook 讀回管道複用 ADR-011，ToS §3(7) 約束明文繼承不放寬：「無 client = 全 deny + 行程暫停」。

### ADR-010（SDK billing response）
計費姿態不變；herdr 驅動互動 TUI 落 cli 訂閱互動桶。

C-hybrid 概念由本 ADR 承接；tmux 實作細節被本 ADR 作廢。

## 結論

herdr 作為持久化終端層可行，C-hybrid 概念延續，SDK 路徑移除 defer 至 #25。後續實作將在 herdr 基礎上完成 Track C 元件。

ToS §3(7) 約束「無 client = 全 deny + 行程暫停」原樣繼承，不放寬。deny 行為與 smallest-client-wins 處理維持 ADR-014 設計意圖。

## 2026-08-02 增修：herdr 原生模型（#29）

### 背景

上文的 hook 讀回管道（承接 ADR-011）有一個結構性上限：它只對「cc-mobile 自己啟動、且注入了 `--settings` 的 claude」有效。使用者自己在終端機開的 claude 沒有那個 settings 檔，因此 cc-mobile 看不到、讀不回、也答不了它的權限提問——而那正是 §1「在手機上繼續終端機的 session」要的東西。

#29 把讀回與權限兩條路都改成向 herdr 要，於是自建與外來 session 不再有差別，自建 hook 管道整套拆除。

### 決策

1. **session 列表來自 `agent.list` 全域列舉**，不再是 cc-mobile 自己的記憶體 Map。手機看得到機器上每一個 claude，包含使用者自己開的（H1）。列表以 `pane_id` 為鍵（H5）：每個 pane 都有、`/clear` 後不變，而 `agent_session.value` 兩者皆不成立。
2. **回覆從 transcript 讀回**（`~/.claude/projects/**/<session>.jsonl`，增量讀取 + `{byteOffset, lastUuid}` 游標），取代 Stop hook POST。附著時游標取檔尾，因此不會把既有對話當成新訊息重播。
3. **權限走 herdr `blocked` + 螢幕解析 + `pane.send_keys`**，取代 PreToolUse hook。`permission_request.tool.parameters` 因此是**解析後的螢幕文字**而非結構化 `input` JSON（H3）——claude 在 blocked 期間 transcript 一個 byte 都不寫（實測 43 秒），螢幕是唯一可機讀來源。選項改由 server 提供（終端機自己的字句與數量，2 或 3 不固定），client 回 `optionId`。
4. **自建 session 改用原生 argv**：`["--permission-mode", mode, "--session-id", uuid]`，不寫 settings 檔（M6）。`server/claude-settings.ts`、`pty-{stop,permission}-hook.ts`、`pty-{response,permission}-{relay,endpoint}.ts` 全數刪除，兩個 HTTP hook 端點回 404。#28（Stop hook 啟動競態）隨之關閉：樹裡已經沒有那個 POST 可以掉。
5. **啟動 remount 掃描刪除**（M12），擁有權改由 workspace label `ccm-<uuid>` 認定。`terminal_teardown` 只關自己開的 pane，外來 pane 一律拒絕且不發任何 RPC（M13）——使用者接受的是「自己送進去的東西自己負責」，不是「誤觸可以殺掉自己的終端機」。

### D2 平價張力（明文記錄）

90 秒無人看管自動 deny（#24）在原生模型下**必須是主動送 `esc`**，而不再是 resolve 一個 promise。這帶來一個舊模型沒有的破壞性：狀態誤判時 `esc` 會落在別的地方。實測 2026-08-02——claude 首次啟動的 trust dialog 在 herdr 眼中是 `idle`，在那裡送 `esc` 等同「No, exit」，直接殺掉 claude。

因此自動 deny 收窄為：**只對 cc-mobile 自建 pane**（外來 pane 有人在鍵盤前，替他取消他還在讀的提問是越權），且送鍵前必須重讀 `agent_status` **並** 重新解析螢幕比對 fingerprint，兩者皆符才送。使用者自己按下的選項走同一道閘。這是平價的代價：外來 pane 的無人看管提問會無限期佔住那一輪。

### H4 裁定（使用者裁決，記錄為已接受的風險）

`--permission-mode bypassPermissions` 的 pane **可驅動**，只標示不封鎖。

本計畫原本建議拒絕注入（比照被刪除的 `remount.ts:220` 收養拒絕），**人為閘門推翻**：「可以送，我自己負責」。這是機器所有者對自己機器的決定，不是技術結論——探測資料裡沒有任何東西讓「對無閘 pane 注入」變得比較安全。裁定保留的義務是**揭露**：`gated:false` 上 wire，卡片與輸入框上方都必須持續顯示無關卡標示，使用者才是在知情下按送出。程式碼裡不存在任何以權限模式為由的拒絕（`session_ungated` 有 repo 全域掃描測試釘住零命中）。

連帶（比 H4 字面稍寬，因此獨立記錄）：M12 刪掉 remount 掃描時，一併刪掉了它對 `bypassPermissions` pane 的收養拒絕。留著會讓兩條規則指向相反方向——自建的無閘 pane 被拒、一模一樣的外來 pane 卻能驅動——而且較弱的那條會贏。其 argv 檢查只以 `gated` 旗標的形式存活。

### 唯一保留的注入拒絕

`session_busy`：`agent_status ∉ {idle, done}`，或提示框裡有人打到一半（沿用 herdr `claude.toml` `live_prompt_box` 的區域界定）。這保護的是「不要覆寫人類半打的輸入」，與 H4 是不同的顧慮，使用者也沒有放棄它。

### 前置條件

herdr 必須能偵測 claude 的 agent 狀態，需先安裝整合：

```bash
herdr integration install claude
```

沒有它，`agent_status` 不會有 `blocked`，權限流程與回覆讀回的觸發都不會發生。

### 對本 ADR 上文的影響

- 「hook 讀回複用 ADR-011 的機制」**作廢**：讀回改自 transcript，權限改自螢幕。
- ToS §3(7)「無 client = 全 deny + 行程暫停」的意圖以 `UnattendedDenyForSelfLaunched` 承接並收窄（見上）：自動送出的鍵只有 `esc`，永遠不會是同意。
- `events.subscribe` 改為單一全域 `pane.updated` 訂閱（M5）：`pane.agent_status_changed` 需要 `pane_id`，對還沒列舉過的 pane 不可能訂閱。
