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

## 2026-08-06 增修：列表放寬到所有 agent 種類（#30）

### 列表不再以種類過濾

`agent.list` 回來的條目一律列出，不再只留 `agent === "claude"`。#29 的 H1 說「機器上每一個 claude 都看得到」，而使用者真正要的是「機器上每一個 agent 都看得到」——過濾掉別種 agent 等於把一個活著的 session 從手機上抹掉，只因為 cc-mobile 讀不回它的對話。

herdr 回報的種類（`agent`）**原樣**進 descriptor 與 wire，不做 enum、不做正規化：herdr 0.8.0 的 label 清單有 21 個且隨版本增減，複製一份到這裡只會讓 daemon 端新增一個標籤就讓 parse 失敗。這與 `ReportedAgentStatusSchema`（schema.ts）同一條理由。

herdr 沒說出種類時（欄位缺席或空字串），descriptor **不帶** `agent` 鍵。缺席是「偵測未完成」，不是「這是 claude」——預設成 claude 會讓查表找錯檔案。

### `readable` 的新語意，仍然只是揭露

`readable = 有 transcript key 且該種類有註冊的 reader`。reader 註冊表（`server/agents/transcript-readers.ts`）目前只有 claude 一筆；omp 的 reader 是 #32。未偵測出的種類靠查表自然落空，沒有為它另寫的特例分支。

`readable` 的地位比照 H4 的 `gated`：**只揭露，不封鎖**。程式碼中沒有任何路徑因為 `readable === false` 而拒絕驅動、拒絕讀回或拒絕權限流程；實際讀不到只來自註冊表回 `null`，卡片上是一個 `no readback` 標示。`drivable` 依然硬編 `true`，種類永遠不會把它打成 `false`。

### 非 claude 的 `blocked` 暫不進權限流程（#33 前的收斂）

權限流程從頭到尾是 claude 的：螢幕解析器讀的是 claude 的提示框，答案是打在 claude 選項清單上的一個鍵。因此**已知**跑著別種 agent 的 pane 進入 `blocked` 時不生成 `permission_request`——這是暫時收斂，等每種 agent 有自己的解析器（#33）就解除。非 `blocked` 的狀態一律照常轉發，pending 才清得掉、90 秒 `esc` 計時器才解除得了。

判斷用 **deny-list（只擋已知非 claude），未知種類放行**，不是 allow-list，理由四點：

1. 沒回報種類的 pane 多半就是偵測還沒完成的 claude——herdr 的 `agent` 來自它自己的探測，可能落後第一則狀態回報。
2. allow-list 錯了救不回來：吞掉一次 `blocked` 後，`pane-events.ts` 的 `status === previous` 早退讓同一個狀態不再重新宣告，整輪都不會重試；`resumePermissions()` 也救不了，因為那則提示從來沒進過 pending。deny-list 錯了只是替一個種類晚到的 pane 多顯示一張提示。
3. 誤觸的代價有界：解析不出選項的螢幕會退成只有 Cancel 的表單，最壞送出 `esc`。
4. cc-mobile 唯一自己送出的鍵（90 秒無人看管的 `esc`）只對自建 pane 生效，而自建 pane 必然是 claude。

pane 的種類由事件層記住（最後一次回報的值，空字串不算回報），部分更新省略該欄位不會抹掉它；`forget()` 會清掉，因此重用的 pane id 從零開始。

---

## 2026-08-06 增修：手機開任意 agent、omp 讀回、omp 權限流（#31–#33）

### #31 `terminal_create` 帶 `agentKind`

`agent.start` 的 `kind` 從寫死的 `"claude"` 變成呼叫端指定。方向決定了型別強度：#30 的 `agent` 是**入站**的 herdr 標籤，用 `z.string()` 讓未知值通過；`agentKind` 是**出站**進 `agent.start` 的執行識別字，用 `z.enum`（`server/agents/kinds.ts`），未列出的種類在 Zod 閘門就被拒，連 workspace 都不會建。缺席 → claude，所以 #31 前快取的 PWA bundle 照舊。

每種 agent 自己的 argv（`registry.ts` 的 `argvFor`）：claude 的 `--permission-mode` / `--session-id` 是 claude 自己的旗標，omp 吃到會死。實測 2026-08-06：`agent.start {kind:"omp", args:[]}` 回 `argv:["omp"]`，且 pane 在 +3.0s 就 `interactive_ready`，既有的 readiness gate 不需要為種類加分支。

`server_config.availableAgents` 列出本機能啟動的種類，判準只有「執行檔在 PATH 上」。**沒有查 herdr 的 integration 狀態**：protocol 19 的方法清單只有 `integration.install`/`uninstall`，沒有 `status`，要查就得 shell out 到 herdr CLI，而 ADR-015 的立場是 socket 才是 trunk。裝整合仍是 CLAUDE.md 記載的一次性設定步驟。

### #32 omp 讀回：key 的**種類**才是分歧點

herdr 對 omp 直接給檔案路徑（`agent_session.kind === "path"`，只有 `pi` 和 `omp` 有），對 claude 給 id。所以 claude 的推導＋掃描對 omp 不只是多餘，而是**錯的**——它會拿 omp 的 key 去翻 `~/.claude/projects`。key 的 kind 因此要送到 reader（`SessionDescriptor.agentSessionKind`，server 端專用，`ws.ts` 按名投影所以不上 wire）。

`readable` 多了一個非對稱的檢查：**path key 才驗檔案存在**。omp 在 `agent.start` 當下就回報路徑，但檔案要等第一輪 turn 才寫——實測純閒置 120 秒後檔案仍不存在（票上原寫的「約 30 秒」是錯的，條件是第一輪對話而非時間）。不驗就會對一個還沒有內容的 session 宣稱可讀。claude 的 id key 不驗：那要跑 `resolveTranscriptPath` 的多目錄掃描，每次列表、每個 pane 都付，而答案在有 id 時必然是「在」。

記錄格式的分歧**不做分派**：一個 mapper 讀兩種詞彙，而且不知道是誰寫的。兩套詞彙不重疊（omp 把所有對話記錄放在 `type:"message"` 底下、role 在裡面；claude 拿 role 當 type），而「讀哪個檔」早就由 reader 註冊表按種類決定了——沒有 reader 的種類拿不到路徑，記錄根本到不了 mapper。票上契約 5 要求「依 agent 欄位分派」，目的（不支援的 agent 不投遞）已由路徑解析達成，手段不同。

### #33 omp 權限流：兩套鍵盤模型

deny-list 改成「有解析器的種類才進流程」＝ claude + omp，未回報種類仍放行（理由同上文四點，未變）。

實測推翻了票上兩個設計前提（spike 2026-08-06，omp 17.2.9）：

- **選項不是四項固定集合**。bundle 裡的 `allow_once`/`allow_always`/`reject_once`/`reject_always` 是常數定義，實際 TUI 對 bash 只畫兩項（Approve / Deny）。所以照 claude 的規則**解析**，不用先驗集合，也不因為解不出四項就判定 unparseable。
- **提示同樣被水平規則上下包夾**，形狀跟 claude 同構。但規則不是 marker：omp 螢幕上還有別的規則（Update Available 橫幅），所以認的是 `Allow tool: `。

該 marker 同時是**分類器**：omp 的 extension 對 API 失敗也回報 `blocked`（429 重試耗盡在 `agent_status` 上跟待答權限完全一樣），沒有 marker 的 blocked 是狀態不是問題，回 `null` 就不會在手機上冒出一張答不了的權限卡。

答題是**距離**不是鍵。omp 的選項沒有編號，靠游標（U+F054，Nerd Font 圖示）標示選中項，所以答案是「從游標現在的位置移動到目標再 Enter」。距離必須用**答題當下**重讀的螢幕算——`guardStillCurrent` 本來就會重讀來驗 fingerprint，改成回傳那次的解析結果即可，不多一次 RPC。游標位置**不進 fingerprint**：終端機前的人移動選擇不代表問題變了，算進去會讓每個手機答案都變成 stale。清單**不 wrap**（實測：在最後一項按 Down 停在原地），所以負方向真的需要 `Up`。讀不到游標位置就不送鍵——那時按 Enter 等於在 Approve/Deny 之間擲硬幣。

因此 `PermissionOption.keystroke` 在 wire 上改為 optional，omp 不帶；client 兩種都用 `optionId` 回答。

`esc` 對 omp **啟用**。omp 自己在螢幕上標 `esc cancel`，實測按下去後 transcript 寫入 `role=toolResult isError=true "Tool call denied by user: bash"`，assistant 接著回覆，turn 正常收尾。票上「行為不明就先不送」的退路沒有用到。

**佇列不需要建模**。票擔心 omp 的 `blockedCount` 引用計數意味著可能同時有多個待答權限。結構上不成立：TUI 一次只畫一個提示，而 cc-mobile 讀的就是螢幕——螢幕本身就是佇列。答完一個之後下一個 `blocked` 會照常觸發下一張卡。

### 注入防護：locator 和 matcher 都要修

`prompt-box.ts` 找「最後兩條水平規則之間」，在 omp 螢幕上抓到的是 Update Available 橫幅。但只修定位不夠：omp 把打到一半的字畫在狀態框的**下邊框行內**（`╰─ half typed thing ─╯`），**完全沒有 caret**，所以 claude 的 `❯`/`>` 比對怎麼定位都回 `false`。兩者都修才真的擋得住覆寫。修之前這是靜默失效——不會 crash，只是手機會直接蓋掉終端機前面的人打到一半的字。

### `gated` 改用各自的詞彙

`permissionModeFromArgv` 只認 `--permission-mode`，omp 的旗標是 `--approval-mode`（`always-ask|write|yolo`，另有 `--auto-approve` 等同 yolo）。不只是名字不同，**預設方向相反**：claude 沒帶旗標是「會問」，omp 沒帶旗標是「不問」（實測：預設的 omp 直接寫檔沒問）。所以沒帶旗標的 omp 是 ungated，徽章要照實說。

### 範圍邊界：手機開的 omp 不帶 approval 旗標（使用者裁決）

cc-mobile 從手機啟動 omp 時**不帶任何 approval 旗標**，沿用 omp 自己的預設（不閘門）。使用者裁決，2026-08-06。連帶結果：#33 處理的是**使用者自己在終端機用 `--approval-mode always-ask` / `write` 開的 omp**；手機開的 omp 不受保護，也不會產生權限提示。要改變這點只需在 `argvFor` 加一個 omp 旗標，是一行的事——但那是安全姿態的選擇，不是實作細節。

---

## 2026-08-06 增修：cc-mobile 不再替 agent 決定設定（取代 ADR-003）

### 決定

移除 cc-mobile 對 agent 設定的所有調整能力：

- `agent.start` 的 argv 不再帶 `--permission-mode`（`--session-id` 留著——那是 transcript 命名，不是設定）
- `--permission-mode` CLI 旗標移除，`ServerConfig.permissionMode` 與 `PermissionMode` 型別一併消失
- `set_permission_mode` / `set_model` / `set_effort` / `set_env_vars` 四則訊息從 `ClientMessage` union 移除，由 Zod 閘門拒絕（回 `invalid_message`）
- `server_config` 只剩 `allowedRoots` / `homeDirectory` / `availableAgents`——伺服器知道而 client 不知道的東西
- `SessionManager` 的 permissionMode / model / effort / envVars 狀態全部刪除
- 設定畫面移除 PERMISSION MODE 區塊、Model 選單（改為顯示 agent 回報的值，靜態）、Environment 編輯器；`ModelSheet` / `EnvVarSheet` / `EnvVarEditor` 三個元件刪除

### 理由

**這是 omp 裁決的對稱結果。** #33 決定手機開的 omp 不帶 approval 旗標，理由是「agent 的閘門姿態是 agent 自己的設定」。同樣的理由對 claude 一字不改地成立；不對稱本身就是提示。

**它一直在傷害北極星性質。** cc-mobile 在啟動時決定一個 session 的安全姿態，而那個 session 之後會被使用者從自己的終端機共用。argv 上的 `--permission-mode` 正是「手機開的 session」與「終端機開的 session」剩下的少數差異之一——#29 已經把 `--settings`、hooks、settings 檔全部拿掉，這是同一條路上的最後一段。

**四則設定訊息本來就是謊。** 它們自 #25 起就收不到 herdr（`ws.ts` 的 TODO 自己寫著「保留只是為了不讓設定 UI 報錯」）。留著一個送出去沒人收的 model 選單，比移除它更違背「直接吃 agent 本來的設定」。

### 保留了什麼（設定 vs 揭露的界線）

界線是：**移除會「設定」的，保留會「回報」的。**

- `sessions[].gated` 保留。它讀 pane 自己的 argv（claude 看 `--permission-mode`、omp 看 `--approval-mode`）來判斷該 session 會不會停下來問。讀別人的旗標不是設定它。
- `capabilities.model` 保留（agent 自己說它在跑什麼），設定畫面改成靜態顯示。
- `permission_request` / `permission` 保留——回答一則提示不是設定一個 mode。

### 連帶影響

`gated` 對 cc-mobile 自建的 claude pane 從此回報 `true`（argv 上沒有 `bypassPermissions` 可讀）。這跟使用者自己在終端機開的 claude 得到的精確度完全一樣——argv 讀不出 settings 檔裡的設定，這個限制本來就存在，只是現在對兩種來源一致了。

### 相容性

無相容視窗，比照 #25 / #26：快取的 PWA bundle 送出退休訊息會收到一則 `invalid_message`，重新載入頁面即恢復。舊 bundle 在 reconnect 時會送 `set_model` / `set_effort`，所以這則錯誤在升級後的第一次連線可能出現一次。
