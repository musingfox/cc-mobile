# ADR-013: Session 生命週期模型 — 一次性確立與無縫跨裝置接力可行性

## Status

Proposed（2026-06-17）

## Context

### 背景

ADR-011 確立了 PTY 驅動互動式 `claude` TUI 的混合架構，並在文末點名一個**尚未拍板的架構子決策**：session 生命週期模型。ADR-012 的 Zellij 可行性評估也明確指出，此拍板是方案B 共存路徑的前置條件，且 `/context-flow:cf` 下游規劃不能在這個問題懸空的情況下展開。

本 ADR 的任務：
1. 把現行架構的生命週期模型定義清楚（是什麼、有哪些已知缺口）。
2. 評估「無縫跨裝置接力（seamless desktop ↔ phone handoff）」在 cc-mobile 自有架構上是否可行，不依賴 Zellij 等外部 multiplexer。
3. 做出單一決策並拍板，供後續規劃消費。

### 現行架構現況（以程式碼為準）

#### `pty-orchestrator.ts` — 一次性驅動模型

`PtyOrchestrator.drive()` 的執行路徑：

1. 收到 `(sessionId, cwd, prompt)` → 若該 sessionId 有存活的 handle 先 `kill()`（H3）。
2. 呼叫 `runPtySession()` 生成新 PTY，等待 claude 跑完一輪回覆（end_turn 或 Stop hook 回傳）。
3. 取得 reply 後，**立即 `hOk?.kill()`** 殺掉 PTY handle（`pty-orchestrator.ts` line 155）。
4. 傳送 `stream_chunk` + `stream_end` 給 client，從 `sessions` Map 刪除 sessionId。

這是明確的**一次性（one-shot）**模型：一個 prompt 對應一次 PTY 行程誕生與消亡。PTY 行程不在多個 prompt 之間存活；每次 `drive()` 都是從 TUI 初始化重新開始。

`cancelAll(sessionIds)` 批次對多個 sessionId 呼叫 `cancel()`，後者設 `cancelled=true` 並 `kill()` handle。

#### `ws.ts` — 斷線即殺行程

`ws.ts` 的 `close()` handler（line 754–767）：

```
close(ws) {
  // Pause pending permissions for potential reconnect
  persistentState.pausedPermissions = permissionHandler.pausePending();
  persistentState.pausedPtyPermissions = ptyRelay.pausePending();

  // Cancel all in-flight PTY sessions to avoid leaking PTY handles
  const ptySessionIds = (ws.data as WsData).ptySessionIds;
  ptyOrchestrator.cancelAll([...(ptySessionIds ?? [])]);

  wsRef = null;
}
```

WS 斷線時，`cancelAll` 殺掉所有仍在跑的 PTY handle。`pausePending` 只保存 permission relay 的 Promise 狀態，但 claude 行程本身已被殺死——重連後 relay 沒有存活的行程可以回應。

#### `EventBuffer`（`ws.ts` line 201）— 事件回放，非行程重接

`ws.ts` 建立了一個容量 500 的 `EventBuffer`，`reconnect` 訊息（`ws.ts` line 679）可從中 replay 已發送過的事件。這是**歷史事件補播**，不是 live 行程的重新 attach：replay 的是 claude 已完成回覆後的事件日誌，不能讓 client 接管仍在跑的 claude 行程。

#### `resume_session` — 歷史重播路徑（SDK query()），非行程重接

`ws.ts` 的 `resume_session` handler（line 532）透過 `sessionManager.createSession(sessionId, cwd, handler.canUseTool, message.sdkSessionId)` 建立新的 SDK `query()` session，傳入舊的 `sdkSessionId` 作為 resume token（`protocol.ts` line 79–83）。這走的是 **SDK query() 路徑**（計費影響路徑），與 PTY live handoff 截然不同：它重播歷史對話紀錄，再起一個全新的 SDK query session，並非讓 client 重接一個正在執行中的 PTY claude 行程。

**`/context-flow:cf` 下游規劃必須區分這兩條路徑，不可混淆**：
- `resume_session` = 歷史重播 + 新 SDK session（已有實作，有計費影響）
- PTY live handoff = 同一 claude 行程跨連線接力（尚未實作，是本 ADR 的評估標的）

---

## 無縫跨裝置接力需求分析（Seamless Handoff Requirements）

「無縫接力」定義：live claude 行程在 client 斷線後存活；重連的 client（手機或桌機）重新 attach 到**同一個**正在執行的行程，而非一個重播歷史的新行程；斷線期間的飛行中狀態（permission-pending 的工具呼叫、串流中的輸出）在重連後繼續有效。

實現此定義需要的架構需求：

1. **行程所有權與連線解耦**：PTY claude 行程的生命週期必須由 server 端的長存守護邏輯持有，不得綁定在 WS 連線物件上。目前 `ptySessionIds` 掛在 `ws.data`（每個連線私有），`cancelAll` 在 `close()` 直接消費它——行程所有權與 WS 連線是一對一綁定的。
2. **孤兒 reaper（orphan reaper）機制**：行程從連線解耦後，必須有 reaper 在 session 超過最大閒置時間後主動終止孤兒行程，否則遺棄的 PTY 行程會洩漏系統資源。
3. **Live re-attach 語義**：重連的 client 送出 re-attach 請求後，server 須將新 WS 的 `send` callback 接入既有的 in-flight `drive()` 輸出管道，讓後續的 `stream_chunk` / `permission_request` 路由到新連線。現行 `sendBuffered` 是在 `drive()` 呼叫時以閉包捕獲的，不支援動態替換。
4. **Permission-pending 協調**：`PreToolUse` hook 阻塞 claude 等候 `permissionDecision`；重連的 client 必須能在 permission-pending 狀態下接手，讓阻塞的 hook 如期取得決定。目前 `ptyRelay.resumePending()` 只有在 poll / timeout 的競爭條件下有機會成功（若 claude 行程已死則無效）。
5. **EventBuffer gap-free 回放保證**：目前 `EventBuffer` 容量 500，`gapDetected` 旗標在 replay 時已有實作；但若斷線時間過長、buffer overflow，重連 client 無法從 gap 後繼續——這對長時間工具執行（如大型 CI job）是實際限制。

---

## 三個子決策

### (a) Session 模型

詳見下方「決策」章節。

### (b) Poll 與 Permission-Pending 協調

當 `PreToolUse` hook 阻塞等待使用者核准時，`runPtySession` 的 poll loop 不應 timeout 刪除 session。ADR-011 `DriveOptions` 已有 `isPermissionPending?: () => boolean` 注入點（`pty-orchestrator.ts` line 37），`ws.ts` 的 `pty_send` handler 也已傳入 `isPermissionPending: () => ptyRelay.hasPendingForSession(sessionId)`（line 732）。

這個 permission-pending / poll 協調機制**在一次性模型下已有基本實作**，但其有效性仍取決於 poll timeout 參數的設定與 relay 600s timeout 的對齊——需在 E2E live 驗證中確認（ADR-011 末段的 EX-11 仍待完成）。

### (c) 斷線策略

- **現行**：斷線 = `cancelAll` = claude 行程終止。意即斷線即 session 結束，無重接可能。
- **長存+重連模型所需**：斷線時不 `cancelAll`，改為把行程轉入「孤兒等待」狀態，由 reaper 在超時後清理。孤兒（orphan）行程若 permission-pending 且無 client 在線，hook 的 600s timeout 最終仍會觸發（回傳 deny 或 timeout error），claude 行程以工具被拒絕方式繼續（或終止）——這個行為需要明確規格，否則 claude 可能在無人監督下繼續執行，牴觸 ToS §3(7)。

---

## 決策

**拍板：維持一次性（one-shot）模型，當前不實作長存+重連（long-lived+reconnect）。**

理由如下：

1. **現行程式碼是明確的一次性設計**。`pty-orchestrator.ts` 的 `drive()` 在每次 reply 後殺掉 handle；`ws.ts` 的 `close()` 呼叫 `cancelAll` 保證無 PTY 行程洩漏。這是有意識的設計選擇，不是疏漏。

2. **長存+重連需要不小的架構改造**。從程式碼讀出的必要改動：
   - 行程所有權從 `ws.data.ptySessionIds`（連線私有）搬移到 server 全域 Map。
   - `close()` 改為暫停而非殺行程（條件：session 有孤兒 TTL 配置）。
   - `drive()` 的 `sendBuffered` 閉包改為可替換的 sink（re-attach 時熱插拔）。
   - 孤兒 reaper 定時任務（否則資源洩漏）。
   - `ptyRelay.resumePending()` 在行程存活的前提下才有意義，需搭配新的行程存活查詢。
   這些改動影響 ws.ts、pty-orchestrator.ts 的核心控制流程，是破壞性重構。

3. **一次性模型下的「重連」已有部分支援**：`EventBuffer` 的 replay + `reconnect` 訊息，讓重連 client 補回已完成的事件日誌；`pausePending`/`resumePending` 讓 permission relay 在重連後繼續等待未解決的 permission（前提：claude 行程仍在跑，即斷線期間 drive() 尚未完成）。這些機制在短暫斷線（< poll cycle）的場景下有實際效果。

4. **真正的無縫接力優先序**：若產品明確需要「手機息屏後桌機繼續、桌機離開後手機接管」的使用情境，長存+重連模型確實是必要的——但這是 P1 之後的功能，且需要先解決 ToS §3(7) 的孤兒行程自主執行問題（見下）。

---

## 可行性結論（Feasibility Verdict）

**CONDITIONAL（條件式可行）**

無縫跨裝置接力（seamless desktop ↔ phone handoff）在 cc-mobile 自有架構上技術可建，但有以下前置條件必須先逐一解決：

1. **PTY live handoff ≠ `resume_session`**：現行 `resume_session` 走 SDK `query()` 路徑，是歷史重播，不是行程重接。`/context-flow:cf` 規劃必須明確區分這兩條路徑，並決定是否為 PTY live handoff 建立獨立的接力協定（新 WS 訊息類型、server 端行程登錄表）。

2. **ToS §3(7) 孤兒行程問題必須先定義**：孤兒 claude 行程在 permission-pending 狀態下無人在線時，hook 600s timeout 觸發後 claude 可能自主執行後續步驟——這違反「純 human-in-the-loop、不自主驅動」的 ToS 要求。長存+重連模型的孤兒策略必須確保：無 client 在線時，所有 permission 一律以 deny 處理，claude 行程暫停而非繼續；此為 architecture-level 的 ToS 合規保證，不得靠「reaper 夠快」來規避。

3. **架構改造必須以獨立 /spiral 輪次執行**：行程所有權搬移 + re-attach sink + reaper 三件事不宜塞入現有 pty 路徑修補，應作為新功能分支完整規劃、gate 驗證、再合入。

條件達成後，架構可建性成立（`EventBuffer`、permission relay 的 pause/resume 已提供基礎骨架），但完整實作的工程量約等於再一輪完整的 /spiral。

---

## 單向門（One-Way Door）警示

**本決策「維持一次性模型」是一道單向門（one-way door）**，在以下意義上難以回退（難回退）：

- 一次性模型確立後，後續每一輪 /spiral 都會在此基礎上建功能（permission UI、context-flow 規劃、多 session 管理）；這些功能的 E2E 測試、UX 流程都以「每次 prompt = 一次行程」為前提。
- 若日後改為長存+重連，上述所有假設需要系統性推翻：ws.ts 的連線生命週期、pty-orchestrator.ts 的 drive() 語義、client 的 session 狀態機都需要同步改寫。
- **這道門開啟的**：目前可立刻聚焦於打通 E2E live 迴路（ADR-011 的 EX-11）、`/context-flow:cf` 的 permission UX 規劃，以及 `resume_session` 的 SDK 路徑完善（無需重寫核心控制流程）。
- **這道門關閉的**：在決策翻轉前，seamless live handoff 不是 cc-mobile 可提供的功能——跨裝置切換只能透過 `resume_session`（歷史重播 + 新對話）實現，不是行程級別的接力。

若產品方向明確需要 live handoff，應在進入下一輪 /spiral 前重新評估此決策；事後翻轉代價隨每輪累積。

---

## ToS §3(7) 約束（不因本決策而放寬）

ADR-011 確立的 ToS §3(7) 紅線——「純 human-in-the-loop、不自主驅動」——**不因本 ADR 選擇一次性模型而放寬，亦不因改為長存+重連模型而自動解決**。

一次性模型下，每次 `drive()` 需有人主動送出 prompt 才觸發（人在環保持）；但若加入「自動重試」、「排程執行」或「permission 自動核准」等功能，即構成 §3(7) 違反，與模型選擇無關。

長存+重連模型下，孤兒行程的自主執行風險（如前述）反而使 §3(7) 合規更難保證；必須在架構層強制「無 client = 所有 permission deny + 行程暫停」才能維持人在環語義。

任何在 cc-mobile 上加入自動化驅動（自動送 prompt、自動核准工具）的功能提案，必須先通過 ToS §3(7) 相容性審查，此為不可繞過的政策約束。

---

## 與既有 ADR 的關係

- **ADR-011**：本 ADR 是 ADR-011 文末「尚未拍板：session 生命週期模型」的正式決策，關閉該懸案。
- **ADR-012**：ADR-012 指出本 ADR 是方案B 的前置條件；本 ADR 決定維持一次性模型，意即方案B 若執行，其 session 管理也以一次性模型為基礎（每次 prompt 對應一次 PTY，不需長存行程）。
- **ADR-010**：計費姿態不變；一次性 PTY drive 仍走訂閱互動桶。
