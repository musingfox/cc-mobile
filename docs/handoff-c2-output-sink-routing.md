# Handoff: C-2 輸出 sink 路由 + 輸入注入(C-hybrid 第二元件)

**來源**:/spiral 範圍確認(turn 1,VERDICT FEASIBLE),人類已就兩個 one-way door 拍板。
**目標流程**:此 baton → /context-flow:cf(baton mode)→ 實作。
**前置**:C-1 TmuxRegistry(`server/tmux-registry.ts`)+ 就緒偵測器(`server/tui-capture-readiness.ts`)已在 main(`50902f4`)。

## 一句話目標
讓 cc-mobile 擁有的 tmux session(`claude --session-id <uuid> --settings <注入 hook>`)能被手機**送入 prompt**(send-keys 注入)、並把它的 **Stop 回覆與權限請求路由回發起該 session 的那個 WS client**。

## 已實證 grounding(事實基礎)
- send-keys 注入已實證:`docs/adr/spike-014/spike-014-3-hook-fire.sh:153`(`send-keys -t SESSION "$PROMPT" "Enter"`),多行 `spike-014b-3-multiline.sh`(每 Enter = 獨立 turn,多行內容須單行串接 + 單 Enter)。
- 核心缺口:`tmux_create`(C-1)只建 session,不走 `pty-orchestrator`,故無人為 tmux session 在 `pty-response-relay` 註冊等待 Promise → Stop hook POST 進來 resolve 不到、回覆遺失;權限請求同樣 404 → 自動 deny。
- relay 以 caller-supplied string 為 key(`pty-response-relay.ts:46,56,78`);Stop hook 送 `payload.session_id`(`pty-stop-hook.ts:39,54`),tmux 下 == `claudeUuid`(`tmux-registry.ts:183`)。key 對得上,只差「有人註冊 waiter」。

## 人類決定(one-way doors,已凍結)
- **D1 = 輸入+輸出一起做**:C-2 含 `tmux_send`(send-keys 注入 prompt)+ **每次送出時**註冊 waiter(對齊現行 PTY 每回合一個 waiter)。
- **D2 = 建 claudeUuid→連線 map**:真正 per-client 路由;每個 tmux session 綁定發起它的連線,Stop 回覆與 `permission_request` 只送該連線(取代 `ws.ts:183` 單一 wsRef 廣播)。

## 協定面變更(protocol.ts)
- **新增** `tmux_send` 進 `ClientMessage` Zod union:`{type:"tmux_send", claudeUuid:string, content:string}`。
- `tmux_create`/`tmux_teardown` 維持 ws.ts seam,**不**入 union(維持 C-1 現狀)。
- Server→Client **不新增 type**:沿用 `stream_chunk`(assistant)+ `stream_end` + `permission_request`;`tmux_created`/`tmux_teardown_result` 既有。

## Specification-by-Example(契約,bun test 可驗、免 live claude/tmux)

| # | Example | 可驗證 handle |
|---|---------|--------------|
| **E1** | `tmux_send{claudeUuid,content}` 注入 prompt 並**於送出時**註冊 waiter(每回合一個)。多行 content 須單行串接 + **單一 Enter**。 | 注入 `runCommand` 攔截 tmux:斷言恰一次 `send-keys -t ccm-<uuid> <single-line> Enter`,arg 內**無內嵌換行**;呼叫後 `responseRelay.hasPending(claudeUuid)===true`。 |
| **E2** | Stop 投遞 `/api/pty-response{session_id:claudeUuid,text:"hi"}` resolve E1 waiter → 發起連線收 `stream_chunk`(assistant,`content:[{type:"text",text:"hi"}]`)+ `stream_end`。 | endpoint 回 200(非 404);bound send 依序收 chunk(shape == `pty-orchestrator.ts:164-179`)+ stream_end。 |
| **E3** | **真正 per-client 隔離**:A、B 兩連線;A 發 `tmux_send(uuidA)`、B 發 `tmux_send(uuidB)`;`/api/pty-response(uuidA)` 只觸發 sink A、**不**觸發 sink B(反向亦然)。 | 兩獨立 send sink;claudeUuid→連線 map 查 uuidA→A;斷言 sinkA 被呼叫、sinkB 計數 0。 |
| **E4** | `/api/pty-permission{session_id:claudeUuid}` 對活 tmux session **不 404**;走 relay 推 `permission_request` 到**發起連線**(經 map,非廣播)。 | `hasSession` seam 對註冊 uuid 回 true;handler 走 `requestPtyPermission`(非 404 分支);sendToClient 經 map 觸發 uuidA→sinkA。 |
| **E5** | 既有 PTY/SDK 路徑 byte-unchanged。 | 既有 `*.test.ts` 全綠;`git diff --name-only` **不含** `session-manager.ts` / `pty-orchestrator.ts`。 |
| **E6** | `tmux_teardown{claudeUuid}`:刪 response waiter(reject/clear)+ 從 map 移除綁定;晚到 Stop POST → 404 `no_pending_response`,不拋。 | teardown 後 `hasPending(uuid)===false` 且 map 查 uuid→undefined;後續 `/api/pty-response(uuid)` 回 404。 |
| **E7** | teardown 後 permission `hasSession(uuid)===false` → 晚到 PreToolUse 404 → hook deny(fail-closed,對齊 `pty-permission-hook.ts:65,92`)。 | teardown 後 `hasSession(uuid)===false`;endpoint 對該 uuid 回 404。 |

### claudeUuid→連線 map 契約
- **註冊**:`tmux_create`(或首次 `tmux_send`)時寫入 `uuid→{send/sendBuffered, wsRef}`。
- **查詢**:response resolve 與 permission sendToClient **都**經此 map 取目標連線。
- **清理**:teardown 與連線 `close` 時移除該連線的所有 uuid 綁定(避免懸掛指向死連線)。

## 硬約束(不變)
- 不改 `server/session-manager.ts`(SDK 路徑)與 `server/pty-orchestrator.ts`(PTY 路徑)既有行為。
- 沿用 `stream_chunk`(assistant)+ `permission_request`;hook 腳本(stop/permission)逐字重用。
- C-3 orphan reaper 不在範圍。最小可行、surgical。

## Unresolved tripwires(/cf 須帶入 plan 的 Unresolved)
1. **斷線重連的 uuid 重綁**:map 以連線物件為值,reconnect 換新 ws 物件時 uuid→舊連線失效;E3/E6 僅驗單連線生命週期內隔離,**未**驗 reconnect 後回覆是否重導向新連線(現行 pty 靠 eventBuffer replay,tmux 是否沿用未定)。
2. **多行串接語意保真**:剝換行為單行可能改 prompt 語意;spike 僅證「能注入且 hook fire」,未證內容保真。串接規則(空白接合 vs 字面)須 /cf 定 example 釘死。
3. **send-keys 就緒時序**:剛建 session 即 `tmux_send` 可能撞 TUI 未就緒(PTY 有 driveReadiness,tmux 無;就緒偵測器 `tui-capture-readiness.ts` 已具備,須接上)。E1 只驗注入動作,真正收到屬 live E2E(O-LIVE),非 bun test 範圍。

## 驗證
- Test runner:`bun test`。全套須綠(基線 762)。
- 注入點:response relay `createPtyResponseRelay`、permission relay `createPtyPermissionRelay`、permission endpoint `createPtyPermissionHandler({relay,hasSession})`、tmux registry `createTmuxRegistry({runCommand,...})`。`tmux_create`/`tmux_send` 的 ws 分支為整合 seam,可抽成可測函式(不得改 pty_send 行為,E5)。
