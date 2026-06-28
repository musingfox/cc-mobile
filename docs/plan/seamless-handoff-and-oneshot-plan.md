# 無縫接力與一次性改善雙軌規劃

> `/context-flow:cf` 交棒文件（baton）— 對應 ADR-013 的執行落地計畫。
>
> 本文件區分兩條獨立開發軌道，分別供後續 `/spiral` 輪次消費：
> - **Track B**：在現行一次性（one-shot）模型上做立即可執行的改善，不動核心控制流程。
> - **Track C**：無縫接力架構改造，三個核心元件的完整重構，視為獨立的 /spiral 輪次。
>
> **閱讀前提**：請先讀 ADR-013（session 生命週期模型）；本文件假設讀者理解一次性模型的決策脈絡。

---

## 路徑區分（ADR-013 強制要求）

ADR-013 明確指出 `/context-flow:cf` 下游規劃**必須區分兩條路徑，不可混淆**：

| 路徑 | 機制 | 現況 | 計費 |
|------|------|------|------|
| `resume_session`（SDK 重播）| `sdkSessionId` 傳入 `sessionManager.createSession()`，起全新 SDK query() session，以舊歷史為上下文 | 已實作（`ws.ts` line 532, `protocol.ts` line 79–83）| 走訂閱互動桶 |
| `live handoff`（行程接力）| 重連 client 重接同一正在執行的 PTY claude 行程，不重啟、不重播 | **尚未實作**；Track C 的目標 | 不新增計費，但需架構改造 |

這兩條路徑在產品層、架構層均截然不同。Track B 改善的是第一條；Track C 才是第二條的實作起點。

---

## Track B — 一次性模型立即改善 (one-shot)

### 背景

ADR-013 決定維持一次性（one-shot）模型。此模型目前已有基本骨架：`EventBuffer(500)`（`ws.ts` line 201）提供事件回放，`reconnect` handler（`ws.ts` line 679）可補播已完成事件，`isPermissionPending` 注入點（`pty-orchestrator.ts` line 37）凍結 poll deadline。但這些機制尚未完整串接，E2E live 驗證仍待補齊（ADR-011 EX-11）。

Track B 目標：在**不破壞一次性模型核心控制流程**的前提下，修補已知缺口並補齊驗收覆蓋。

---

### B-1：E2E Live 迴路驗收（ADR-011 EX-11）

**目標**：確認 PTY happy-path 在真實 `claude` binary 下端對端可通，輸出正確抵達 client。

**接縫位置**：
- `ws.ts` `pty_send` handler（line 706–738）：驅動 `ptyOrchestrator.drive()` 並透過 `sendBuffered` 把 `stream_chunk` + `stream_end` 推送至 client。
- `pty-orchestrator.ts` `drive()`（line 88–181）：一次性驅動，reply 取得後立即 `hOk?.kill()`（line 155）並清除 session。

**原子任務**：
1. 在 CI/本機建立 live E2E 測試腳本（`bun:test` 或 Playwright），對 `/api/pty_send` WS 路徑送出 `pty_send` 訊息，斷言收到 `stream_chunk`（`role: "assistant"`）後收到 `stream_end`，timeout ≤ 120s。
2. 測試環境腳本確認 `claude` binary 存在並可執行；若不存在則 skip（非 CI failure）。
3. 在 `ecosystem.config.cjs` 或 CI workflow 中記錄此測試為「需要 claude binary 的 integration gate」，與純單元測試分層。

**驗收（acceptance）**：
- `bun run test:e2e --grep "live E2E"` 在有 `claude` binary 的環境下 GREEN。
- `stream_chunk` 的 `chunk.message.role` 必須為 `"assistant"`。
- 無孤兒 PTY 行程殘留（測試結束後 `ps aux | grep claude` 不含測試 sessionId 的行程）。

---

### B-2：`resume_session` SDK 路徑補齊與錯誤路徑強化

**目標**：`resume_session`（SDK 重播路徑）的錯誤路徑、歷史載入失敗的降級行為，以及 `sdkSessionId` 格式驗證需更健壯。

**接縫位置**：
- `ws.ts` line 532–583：`resume_session` handler，含 `sessionManager.createSession()` 與 `loadSessionHistory()`。
- `protocol.ts` line 79–83：`ResumeSessionMessage` schema，目前 `sdkSessionId` 只驗 `z.string()`，無格式約束。

**原子任務**：
1. 在 `protocol.ts` 的 `ResumeSessionMessage` 加入 `sdkSessionId` 格式驗證（非空字串，長度上限 256，不含路徑分隔符）；Zod `.refine()` 即可，不需外部 validator。
2. `resume_session` handler 在 `sessionManager.createSession()` 拋出時，送出 `{ type: "error", code: "resume_failed" }`，並清理半初始化的 session 狀態，確保後續同 WS 連線可再嘗試。
3. 歷史載入失敗（`loadSessionHistory` throw）的降級路徑已存在（`ws.ts` line 578–583），補齊對應的單元測試：mock `loadSessionHistory` 拋出，斷言 client 仍收到 `session_history`（空陣列）而非無響應。

**驗收（acceptance）**：
- `protocol.ts` 的 Zod schema 針對空字串、超長字串的 `sdkSessionId` 輸入拋出 `ZodError`，有對應的單元測試 GREEN。
- `resume_session` 在 `createSession` 失敗時，WS 連線上可觀測到 `error` 訊息，不靜默。
- 歷史降級測試 GREEN。

---

### B-3：`EventBuffer` 重連回放的 gap 偵測行為補齊

**目標**：強化 `reconnect` + `EventBuffer` 路徑的 gap 偵測語義，確保 client 在 buffer overflow 後收到明確的 `gapDetected: true`，而非靜默補播不完整序列。

**接縫位置**：
- `ws.ts` line 678–703：`reconnect` handler，現已讀取 `eventBuffer.getStats()` 並計算 `gapDetected`。
- `EventBuffer(500)`（line 201）：定容 ring buffer，overflow 時最舊事件被覆蓋。

**原子任務**：
1. 撰寫 `EventBuffer` 的單元測試：塞入超過 500 筆事件，從 `lastEventId=0` 重連，斷言 `gapDetected: true` 且 `replay_complete` 訊息中 `eventsReplayed < 500`。
2. 在 `reconnect` handler 的 `replay_complete` 回應中，當 `gapDetected: true` 時加入 `gapFrom: stats.oldest`（最早可回放的 eventId），讓 client 端可顯示「部分事件已遺失，請從 `resume_session` 重建對話」的提示，而非靜默顯示不完整輸出。
3. 更新 `protocol.ts` 的 `replay_complete` schema，加入 `gapFrom?: number` 欄位。

**驗收（acceptance）**：
- 單元測試中 overflow 後重連，`replay_complete.gapDetected` 為 `true`，`gapFrom` 為 buffer 中最舊的 eventId。
- `protocol.ts` schema 加入 `gapFrom` 欄位，並有對應型別測試確認序列化正確。

---

### B-4：Permission-Pending 中斷線的 `pausePending`/`resumePending` 整合測試

**目標**：驗證在 PTY permission-pending 狀態下斷線再重連，`ptyRelay.resumePending()` 能正確讓等待中的 hook 在行程仍存活時繼續等待。

**接縫位置**：
- `ws.ts` `close()` handler（line 754–767）：`ptyRelay.pausePending()` 保存 permission relay 狀態，`cancelAll` 殺掉 PTY 行程。
- `pty-orchestrator.ts` `DriveOptions.isPermissionPending`（line 37）：凍結 poll deadline。
- 現行問題：`close()` 先 `pausePending`，接著 `cancelAll`——行程已死，`resumePending` 在重連後無 live 行程可回應，只能 timeout。

**原子任務**：
1. 撰寫整合測試，模擬：送出 `pty_send` → 行程進入 `isPermissionPending=true` → 關閉 WS → 重新連線 → 送出 `permission` 決定。斷言：重連後 `ptyRelay.resumePending()` 被呼叫；permission 決定被送出；**由於行程已死（cancelAll 在 close），預期 timeout 或 `permission_denied` error**，而非靜默掛住。
2. 在 `ws.ts` 的 `open()` handler 中，重連後若有 `pausedPtyPermissions` 存在，自動送出 `resumePending()`，並對每個孤兒 permission 立即回傳 `error` 告知 client「行程已結束，permission 無效」，避免 UI 卡在等待決定的狀態。
3. 補充 JSDoc 於 `close()` handler，明確記錄「cancelAll 在 pausePending 之後執行」的順序意圖，以及「重連後 resumePending 的行程已死」這個已知限制。

**驗收（acceptance）**：
- 整合測試 GREEN，重連後孤兒 permission 不靜默掛住，client 端可觀測到明確的 error 訊息。
- 無新的 PTY handle 洩漏（測試結束後 `ptyOrchestrator.hasSession()` 為 false）。
- `ws.ts` `close()` handler 含清楚的 JSDoc 順序說明。

---

### B-5：`ws.ts` 與 `pty-orchestrator.ts` 的接縫單元測試補強

**目標**：H3（kill-prior on re-drive）與 H4（cancel-during-spawn suppress send）兩個保證的測試覆蓋率，並確認 `cancelAll` 只取消列舉中的 sessionId，不影響其他 session。

**接縫位置**：
- `pty-orchestrator.ts` line 101–109（H3），line 126–133（H4），line 214–218（cancelAll 選擇性取消）。

**原子任務**：
1. 補充 H3 測試：同一 sessionId 連續呼叫 `drive()` 兩次（第二次在第一次 resolve 前），確認第一次的 PTY handle 被 kill，且只有第二次的 `stream_end` 被 send。
2. 補充 H4 測試：在 `onHandle` 回呼前設定 `cancel(sessionId)`，確認 handle 被 kill 且 send 從未被呼叫。
3. 補充 `cancelAll` 邊界測試：3 個 session，`cancelAll` 只傳 2 個，確認第 3 個 session 的 handle 未被 kill。

**驗收（acceptance）**：
- `bun test` 針對上述三個案例全數 GREEN，無殘留 handle 洩漏。

---

## Track C — 無縫接力改造 (seamless handoff)

### 背景

ADR-013 已明確：無縫跨裝置接力（seamless desktop ↔ phone handoff）在技術上條件式可行，但需要不小的架構改造，且改動影響 `ws.ts`、`pty-orchestrator.ts` 的核心控制流程，屬破壞性重構。本軌道將改造分解為三個獨立可驗收的元件，每個元件皆可單獨立 /spiral 輪次執行。

**架構前提**：Track C 假設 auto 模式（permission mode = "auto"）是主要使用情境的前提（premise），使得 permission-stranding 問題在實務上降為次要——但設計上不硬依賴 auto 模式，孤兒行程的 fallback 策略必須在架構層保證，而非靠「使用者通常開 auto」來規避 ToS §3(7)。

---

### C-1：行程所有權登錄表（Process Registry）

**問題根源**：目前 `ptySessionIds` 掛在 `ws.data`（每條 WS 連線私有），`close()` 的 `cancelAll` 直接消費它。行程所有權與 WS 連線一對一綁定，是阻礙 live handoff 的根本原因。

**元件定義**：建立 server 全域的 `ProcessRegistry`（一個獨立模組，暴露 `register(sessionId, handle)` / `deregister(sessionId)` / `get(sessionId)` / `listOrphaned()` API），取代現行散落在 `ws.data` 的所有權模型。`PtyOrchestrator` 的 `sessions` Map 升格為此 registry 的後端存儲，或 registry 注入 orchestrator。

**對 `pty-orchestrator.ts` 的破壞性改動**：
- `sessions` Map 的 key/value 結構可能需要調整，加入 TTL metadata 與 clientId 欄位。
- `cancel()` / `cancelAll()` 邏輯需與 registry 的所有權語義對齊：cancel 是「立即終止」，deregister 是「解除所有權但不殺行程」。

**對 `ws.ts` 的破壞性改動**：
- `ws.data.ptySessionIds` 欄位廢棄；`close()` 不再從 `ws.data` 讀取 sessionId 清單。
- `close()` 改為：把本連線的 PTY session 轉為孤兒狀態（透過 registry），而非直接 `cancelAll`。

**驗收（acceptance）**：
- `ProcessRegistry` 有完整單元測試，涵蓋 register/deregister/get/listOrphaned。
- `ws.ts` `close()` 不再呼叫 `cancelAll`；改為呼叫 `registry.markOrphaned(sessionIds)`。
- 現有 B-5 的 cancelAll 測試仍 GREEN（或已對應更新）。

---

### C-2：熱插拔輸出 Sink（Hot-Swap Output Sink）

**問題根源**：`drive()` 在呼叫時以 `(msg) => sendBuffered(ws, sessionId, msg)` 閉包捕獲 WS 連線的 `send`，不支援動態替換。重連的 client 即使行程存活，也無法讓後續的 `stream_chunk` / `permission_request` 路由到新連線（`ws.ts` line 731 的 `sendBuffered` 閉包是一次性綁定）。

**元件定義**：在 `PtyOrchestrator` 或新的 `SinkRouter` 模組中，引入可熱插拔的 sink 介面。`drive()` 不直接捕獲 `ws.send`，改為從 registry/router 取得 sink，並在 re-attach 時呼叫 `router.swapSink(sessionId, newSend)` 讓後續輸出路由到新連線。`sendBuffered` 重構為非閉包形式。

**對 `pty-orchestrator.ts` 的破壞性改動**：
- `drive()` 的 `send` 參數語義從「呼叫時綁定」改為「可在 drive 執行中被替換」。
- 需要 send seam 的 thread-safety 考量（Bun 的 event loop 是單執行緒，但 sink swap 的時序需要明確定義：swap 後的第一個事件保證走新 sink）。

**對 `ws.ts` 的破壞性改動**：
- `pty_send` handler 不再直接傳閉包給 `drive()`；改為先在 router 登記 sink，再呼叫 `drive()`。
- 新增 `reattach` WS 訊息類型（或擴充 `reconnect`）讓重連 client 觸發 `router.swapSink()`。

**驗收（acceptance）**：
- 單元測試中，模擬 `drive()` 執行中途呼叫 `swapSink()`，確認後續 `stream_chunk` 路由到新 sink，舊 sink 不再接收事件。
- `sendBuffered` 不再依賴閉包捕獲的 WS 物件；改由 router 動態查找。
- `protocol.ts` 新增 `reattach` 訊息 schema，有 Zod 單元測試。

---

### C-3：孤兒 Reaper（Orphan Reaper）

**問題根源**：行程所有權從 WS 連線解耦後，孤兒（orphan）行程若無人認領，會洩漏 PTY handle。ADR-013 明確要求 reaper 作為前置條件之一。

**無 client 回退策略（ToS §3(7) 合規要求）**：
當孤兒行程處於 permission-pending 狀態且無 client 在線時，系統必須主動拒絕（deny）該 permission 並暫停（suspend/pause）行程，而非讓 claude 在無人監督下繼續自主執行。具體行為：
- `PreToolUse` hook 的 permission relay 在偵測到孤兒狀態時，立即以 `deny` 回傳，而非等待 600s timeout。
- claude 行程收到 deny 後可能自行終止或繼續（取決於工具種類）；reaper 在 TTL 到期後無論如何都呼叫 `handle.kill()`。
- 此設計不硬依賴 auto 模式——即使使用者偶爾在非 auto 模式下斷線，孤兒行程也有確定性的拒絕結果。

**元件定義**：一個定時任務（`setInterval` 或 Bun cron-like 機制），週期性掃描 `ProcessRegistry.listOrphaned()`，對超過 TTL（建議 5 分鐘，可配置）的孤兒行程：
1. 對所有 pending permission 送出 deny（呼叫 `ptyRelay.denyAll(sessionId)`，需新增此 API）。
2. 呼叫 `handle.kill()` 終止行程。
3. 呼叫 `registry.deregister(sessionId)` 清理登錄表。

**對 `pty-orchestrator.ts` 的破壞性改動**：
- `cancel()` 語義分離為 `kill(sessionId)`（立即終止）與 `reap(sessionId)`（deny-then-kill），需新增 `reap()` 方法。

**對 `ws.ts` 的破壞性改動**：
- `close()` 不再 `cancelAll`；改為呼叫 `registry.markOrphaned()`，reaper 接手後續清理。
- `open()` 時若有對應 orphaned session，觸發 re-attach 流程而非建立新 session。

**驗收（acceptance）**：
- 單元測試：孤兒行程超過 TTL 後，`handle.kill()` 被呼叫，`ptyRelay.denyAll()` 在 kill 之前被呼叫。
- 整合測試：permission-pending 孤兒行程在 deny 後，`stream_end`（或 error 事件）最終被路由到後來重連的 client，無事件靜默丟失。
- 無孤兒 handle 洩漏（測試結束後 `registry.listOrphaned()` 為空）。

---

### C-4：Track C 風險與規模評估

**風險（risk）與破壞性（breaking）分析**：

Track C 的三個元件（C-1 Registry、C-2 熱插拔 Sink、C-3 Reaper）是**協同破壞性（co-breaking）**的改動：任何一個單獨實作都需要另外兩個才能形成完整的生命週期保證，不可只實作其中一個就宣稱「部分支援 live handoff」。

**`ws.ts` 的重構範圍**：
- `close()` handler 完全改寫（cancelAll → markOrphaned）。
- `open()` handler 加入 orphaned session 偵測與 re-attach 分支。
- `pty_send` handler 改為 router 登記模式。
- 新增 `reattach` 訊息 case。
- 估計改動行數：`ws.ts` 現有 ~770 行，影響約 150–200 行核心控制流程。

**`pty-orchestrator.ts` 的重構範圍**：
- `SessionState` 介面加入 TTL / orphanedAt / clientId metadata。
- `cancel()` 分裂為 `kill()` + `reap()`。
- `drive()` 的 send 綁定改為 router 查找（破壞現有所有呼叫端的 API contract）。
- 估計改動行數：現有 ~220 行，影響約 80–100 行。

**整體規模**：Track C 的實作工程量约等于一輪完整的 /spiral（ADR-013 原文估計），且需要獨立的架構 gate 驗證再合入。不應與 Track B 任何任務在同一 PR 混合交付。

---

## 順序建議（sequencing）

**建議先執行 Track B，再執行 Track C**。

理由如下：

1. **Track B 先行，確立基線**：B-1（E2E live 迴路）是 ADR-011 的未竟工作（EX-11）；在 Track C 的架構改造開始前，必須有一個可信的 E2E 驗證基線。否則 Track C 合入後無法區分「新 bug」與「原本就壞」。

2. **Track B 提供 Track C 的測試防護網**：B-5 的 H3/H4 單元測試在 Track C 重構 `pty-orchestrator.ts` 後仍需 GREEN；B-3 的 EventBuffer 測試在 Track C 引入 Sink Router 後需要對應更新。先有測試，改起來才安全。

3. **Track C 是單向門（one-way door）**：一旦 `ws.ts` 的 `close()` 不再 `cancelAll`，原有的「斷線即清理」保證失效；這個改動影響所有後續 /spiral 輪次對 session 生命週期的假設。B 軌的功能（permission UX、context-flow UI）應在此門開啟前完成並驗收。

4. **auto 模式前提的時序合理性**：Track B 的 B-4 任務（permission-pending 斷線整合測試）雖然揭示了孤兒 permission 的邊界案例，但在 auto 模式作為前提的使用情境下，permission-stranding 的實際發生頻率極低——足以支撐先出 Track B、觀察實際使用反饋，再決定是否啟動 Track C。

**建議順序**：B-1 → B-2 → B-3 → B-4 → B-5（可並行部分任務）→ C-1 → C-2 → C-3（C 三件事必須同批合入）

---

## auto 模式的前提說明

auto 模式（permission mode = `"auto"`）是本規劃的設計前提（premise），而非硬性依賴（不依賴 auto 才能運作）：

- **前提意義**：實際使用者在開發機上跑 cc-mobile 時，通常以 auto 模式執行，permission-stranding 問題（孤兒行程等待人工決定）在實務上極少發生。這使得 Track B 的 B-4 雖揭示邊界案例，但不構成阻止 Track B 交付的 blocker。

- **不硬依賴的設計保證**：Track C 的 C-3 Reaper 必須在非 auto 模式下也能正確 deny 孤兒 permission；不得以「反正使用者開 auto」作為孤兒策略的唯一保障。ToS §3(7) 的合規要求是架構層約束，與 permission mode 設定無關。

- **Track B 不改 permission mode 邏輯**：B 軌所有任務均不觸碰 `SetPermissionModeMessage` 或 permission mode 決策流程；這些屬於 Track C 合入後才需要與新的孤兒 deny 策略整合的部分。

---

## 附錄：接縫索引（供後續 /spiral 快速定位）

| 符號 | 位置 | 說明 |
|------|------|------|
| `EventBuffer(500)` | `ws.ts` line 201 | 定容 ring buffer，overflow 時最舊事件被覆蓋 |
| `sendBuffered` closure | `ws.ts` line 209–212 | 一次性綁定 WS send 的閉包，Track C C-2 需重構 |
| `resume_session` handler | `ws.ts` line 532 | SDK 重播路徑入口，消費 `sdkSessionId` |
| `reconnect` handler | `ws.ts` line 678 | 補播 EventBuffer 歷史事件，含 gapDetected 邏輯 |
| `close()` handler | `ws.ts` line 754 | pausePending + cancelAll，Track C C-1/C-3 需改寫 |
| `DriveOptions.isPermissionPending` | `pty-orchestrator.ts` line 37 | 凍結 poll deadline 的注入點 |
| `drive()` → `hOk?.kill()` | `pty-orchestrator.ts` line 155 | 一次性模型的 PTY 行程終止點 |
| `cancelAll()` | `pty-orchestrator.ts` line 214 | 批次取消，Track C C-1 後語義改變 |
| `ResumeSessionMessage` | `protocol.ts` line 79–83 | SDK 重播的 WS 訊息 schema |
