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

### herdr socket API 契約摘要

herdr 提供以下主要 API（JSON-RPC）：

- `session.snapshot`
- `pane.send_text`
- `pane.send_keys`
- `pane.read`
- `events.subscribe`（含 `pane.agent_status_changed`）
- `agent attach`

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

