# Handoff: C-3 無人看管安全閘 + 生命週期(C-hybrid 第三元件)

**來源**:/spiral 範圍確認(turn 1,VERDICT FEASIBLE),人類已就 one-way door DOOR-1 拍板。
**目標流程**:此 baton → /context-flow:cf(baton mode)→ 實作。
**前置**:C-1 TmuxRegistry + C-2(tmux_send / claudeUuid→連線 map / Stop+permission 路由 / teardown+close 清理)已在 main(`2d62141`)。

## 一句話目標
讓**無人看管的 tmux session**安全且不洩漏:斷線時 in-flight 權限請求被暫停(不 auto-proceed)、重連時續審、無人時 90s 後 deny;server 關閉時一律 kill 所有 registry session。

## 已實證 grounding(現況,file:line)
- **(A) 安全閘偏離**:ws close 對 `tmuxPermissionRelay` **完全沒處理**(`ws.ts:867-884` 只動 ptyRelay/ptyOrchestrator/tmuxSendRouting)。無人看管時 tmux 權限請求 sink 為 undefined → 不送 client → Promise 懸掛到 **600000ms (10min)** 才 deny(`pty-permission-relay.ts:49,70-88`;hook `pty-permission-hook.ts:73-76,92`)。方向對(終會 deny、不 auto-proceed),但延遲 10 分鐘不符紅線「即刻」,且無暫停語意。
- **(B) reaper 缺口**:`tmux-registry.ts` 的 teardown 只在 explicit `tmux_teardown` 觸發(`ws.ts:362`);**無 shutdown hook、無 SIGTERM kill**(grep 證實唯一 SIGTERM 在 pty-driver.ts:89,非 tmux)。server 重啟後 in-memory `sessions` map 全忘,但 OS 裡 `ccm-<uuid>` tmux session 永久殘留。
- **(C) rebind 部分具備**:重連後再發 `tmux_send(uuid)` → registerClient 重綁 sink,新一輪回覆可達(`ws.ts:810-814`,`tmux-send-routing.ts:63-85`)。但 **in-flight 權限狀態遺失**:tmuxPermissionRelay 在 close 未 pausePending、open 無 resume 路徑(對比 ptyRelay 有,`ws.ts:316,872`)。

## 人類決定(one-way door,已凍結)
- **DOOR-1 = pause+resume + 縮短 timeout**:比照既有 ptyRelay 的 pause/resume。close 時 pausePending(快照、不 resolve、不 auto-proceed),重連 registerClient 後 resumePending(重送 permission_request 給新 sink + 接管剩餘 timer);unattended deny timeout 從 600000ms 縮短為 **90000ms(90s,可注入/可調 tunable)**。
- **DOOR-2/3/4(two-way,採預設)**:無主動輪詢 reaper;shutdown 掛 SIGTERM+SIGINT 迭代 `teardownAll`;unattended 判準 = `getClient(sessionId)===undefined`。

## 須新增的最小 API
- **tmuxPermissionRelay(relay 實例)**:**零新增**。`createPtyPermissionRelay` 已內建 `pausePending()`/`resumePending()`(`pty-permission-relay.ts:182-189`),直接呼用。
- **ws.ts 接線(本輪核心)**:
  - 新增 `persistentState.pausedTmuxPermissions: PtyRelaySnapshot[]`(比照 `pausedPtyPermissions` `ws.ts:207`)。
  - `close(ws)`:`persistentState.pausedTmuxPermissions = tmuxPermissionRelay.pausePending()`(`ws.ts:872` 旁)。
  - resume 觸發點 = **`tmux_send` 的 registerClient 重綁後**(非 ws.open,因 tmux sink 綁定在 registerClient 才發生,DOOR-4):`tmuxPermissionRelay.resumePending(persistentState.pausedTmuxPermissions)` 後清空陣列(`ws.ts:810-814` 旁)。
  - 生產 `tmuxPermissionRelay` 建構傳 `{ timeoutMs: 90000 }`(`ws.ts:240`),標 tunable。
  - 啟動處註冊 `process.on('SIGTERM'|'SIGINT')` → `tmuxRegistry.teardownAll()`。
- **tmux-registry.ts**:新增 `listSessions()`(或唯讀迭代)+ `teardownAll(): Promise<void>`(迭代 `sessions` 對每個呼既有 teardown 邏輯)。`createSession/hasSession/teardown` 行為不變。

## 協定面變更
**無新 WS message**。resume 重送的 `permission_request` 與首送同型,client 既有 handler 自然接住。沿用 open/close 生命週期 + `tmux_send` 觸發 registerClient。

## Specification-by-Example(契約,bun test 可驗、免 live tmux/claude;注入 setTimeoutFn/runCommand/sink)

### A — 安全閘(pause+resume + 90s unattended timeout)
| # | Example | 可驗證 handle |
|---|---------|--------------|
| **EX-A0** | tmuxPermissionRelay 收請求且 `getClient(sessionId)===undefined` 時**絕不** resolve `{allow:true}`。 | 注入 setTimeoutFn + sink-missing stub;斷言 timeout 後 resolve `{allow:false}`,期間從不 true。 |
| **EX-A1** | ws close 時 in-flight tmux 權限請求被**快照、不 resolve、不刪 map、清 timer**。 | registerClient(ws1)→ requestPtyPermission(in-flight)→ `pausePending()`;斷言回傳快照含 toolUseId+sessionId+elapsedMs,Promise **未** resolve,`getPendingCount()`≥1。 |
| **EX-A2** | 無人看管(sink 缺失未重連)最大窗口 = 注入 `timeoutMs` 預設 90000ms;逾時 deny。 | 注入時鐘以 `timeoutMs:90000` 建 relay,推進 90000ms → resolve `{allow:false}`;推進 89999ms 尚未 resolve。並斷言生產接線預設=90000(非 600000)。 |

### B — reaper-lite(衛生)
| # | Example | 可驗證 handle |
|---|---------|--------------|
| **EX-B1** | registry 暴露列舉 + `teardownAll()`。 | createSession 兩個(claudeBin='sleep')→ `teardownAll()` → 注入 runCommand 對每個呼 `tmux kill-session -t ccm-<uuid>`,`_sessions` 清空,settings 檔 unlink。 |
| **EX-B2** | SIGTERM+SIGINT 觸發 teardownAll。 | spy registry;斷言 ws.ts 啟動對兩 signal 各註冊 handler 且 handler 呼 `teardownAll`(spy 驗接線,免真送 signal)。 |
| **EX-B3** | 無主動輪詢 reaper(邊界鎖)。 | registry 不含 setInterval/掃描定時器。 |

### C — reconnect rebind
| # | Example | 可驗證 handle |
|---|---------|--------------|
| **EX-C1** | 重連後再發 tmux_send(uuid),sink 重綁,新一輪 Stop 回覆只送新 sink。 | registerClient(ws1)→ cleanupByOwner(ws1)→ registerClient(ws2)→ send+relay 解析;斷言僅 ws2 收 stream_chunk+stream_end。 |
| **EX-C2** | 重連時 `resumePending(snapshots)` 對未過期項**重送 permission_request 給新 sink + 接管剩餘 timer**;已過期(remaining≤0)項乾淨 deny 不重送。 | pausePending 取快照 → registerClient(ws2)→ resumePending;斷言新 sink 收 permission_request(toolUseId 一致),推進剩餘時間後 resolve `{allow:false}`;對 elapsed≥timeout 快照斷言不重送且立即 deny。 |

## 硬約束(不變)
- 不改 `session-manager.ts`、`pty-orchestrator.ts` 既有行為。
- 沿用 C-2 seam(`tmux-send-routing.ts` 不改、`tmux-registry.ts` 只新增、relay seam);ptyRelay pause/resume 既有路徑為對照範本。
- surgical;`bun test` 全綠(基線 783);不觸 EX-A0/B1/B3/C1 既凍行為。

## Unresolved tripwires(/cf 須帶入 plan 的 Unresolved)
1. **TRIP-1(真機)**:SIGTERM/SIGINT → teardownAll 在真 tmux+真 claude 上 kill 乾淨(現僅 spy/注入驗接線)→ O-LIVE。
2. **TRIP-2(時序)**:pausePending 清 timer 後、resume 前的視窗不計時 —— 須在 /cf 確認「暫停=凍結倒數」是預期語意(resumePending 對已 resolve 項 `pty-permission-relay.ts:158-159` 已 no-op)。
3. **TRIP-3(多重連競態)**:同 uuid 短時間多次 registerClient 時 resumePending 是否重複重送/重複接管 timer → plan 須含冪等性 test case。
4. **TRIP-4(shutdown in-flight)**:SIGTERM teardownAll 時若有 in-flight 權限 pending,kill-session 後 hook HTTP 端 deny 行為(非本輪契約涵蓋,標記觀察)。

## 驗證 / shard 建議
- Test runner:`bun test`(全套 gate);SHARD_TEST_RUNNER = 各 shard 新測試檔(hermetic,注入 seam)。
- A/B/C 三組可平行;ws.ts 接線依賴 registry `teardownAll`(EX-B1)先行,其餘 relay-side 測試彼此獨立。
- 注入點:`createPtyPermissionRelay(send,{timeoutMs,setTimeoutFn,clearTimeoutFn})`、`createTmuxRegistry({runCommand,claudeBin:'sleep'})`、tmuxSendRouting 已全可注入。
