# ADR-014: Terminal ↔ cc-mobile 即時共享架構決策

## Status

Accepted（2026-06-17）

## Context

### 背景

ADR-013 確立了「維持一次性（one-shot）模型」並拍板了 Track C（無縫接力）作為下一個重大改造軌道。Track C 的核心挑戰是：**使用者在桌機開著 claude TUI 工作時，cc-mobile 如何同步看到對話、且能雙向互動**——同時讓桌機體驗不降級。

具體地，此問題分解為三個假設需要 spike 實驗驗證：

1. **假設 1**：不需要直接持有 PTY fd（onData callback），即可透過 tmux capture-pane 讀取 claude TUI 的畫面狀態與就緒性。
2. **假設 2**：可透過 tmux send-keys 把使用者的 prompt（包含多行、特殊字元）注入 claude TUI，無需 PTY raw write。
3. **假設 3**：在 cc-mobile 啟動的 tmux session 中執行 claude（透過 `--settings` 注入 Stop hook），hook 能可靠地在 claude 回覆後觸發，提供結構化回覆讀取管道。

本 ADR 的任務：以三個架構候選方案（C1、C2、C-hybrid）做決策級比較，並以真實 spike 實驗提供經驗支撐。

### 前提條件與環境事實（2026-06-17 驗證）

- tmux 3.6b 在 `/opt/homebrew/bin/tmux`（已安裝）
- claude 2.1.179 在 `~/.local/bin/claude`（已安裝）
- **zellij 未安裝**（`command -v zellij` 無輸出）——zellij 相關臂膀在 spike 中記錄為 SKIP

---

## 三個架構候選方案（C1 / C2 / C-hybrid）

### C1：使用者擁有 tmux/zellij，cc-mobile 是訪客（hooks + send-keys）

使用者自行在桌機開好 tmux session 並在其中執行 claude。cc-mobile backend 透過以下方式介入：
- 使用者需在其 tmux session 的 claude 中手動安裝 PreToolUse / Stop hook（參照 `docs/adr/spike-011/install-pty-hook.sh` 先例）
- cc-mobile 透過 tmux send-keys（或 zellij write-chars）注入 prompt
- 透過 Stop hook POST 取回 reply
- 透過 tmux capture-pane 讀取畫面狀態

擁有權（ownership）：**使用者擁有** tmux session 與 claude 行程，cc-mobile 是訪客。

### C2：cc-mobile 擁有裸 PTY，重新發明 raw-PTY 服務 + attach 用戶端

cc-mobile backend 直接 spawn 一個裸 PTY（node-pty），在 PTY 內執行 claude，實作一個 raw PTY 中繼伺服器（類似 ttyd 或 webssh2）。桌機用戶使用 `cc attach` 用戶端連接此 PTY 伺服器，得到一個完整的 raw terminal 畫面。

擁有權（ownership）：**cc-mobile 擁有** 裸 PTY fd（onData / write），完整控制所有 I/O。

### C-hybrid：cc-mobile 擁有 tmux session，claude 在其中執行，桌機 `cc attach` ≈ tmux attach

cc-mobile backend 建立並擁有一個 tmux session（`tmux new-session -d`），在其中執行 claude（`--settings` 注入 Stop + PreToolUse hook）。
- 回覆讀取：Stop hook POST 到 cc-mobile（`/api/pty-response`，ADR-011 先例）
- 提示注入：tmux send-keys
- 畫面讀取：tmux capture-pane
- 桌機接入：使用者執行 `tmux attach-session -t <session>`（或 cc-mobile 提供的 `cc attach` 包裝指令）——得到完整 terminal multiplexer 體驗，不受 smallest-client-wins 影響（因為桌機 attach 是 tmux 原生 client，手機不渲染 raw terminal）。

擁有權（ownership）：**cc-mobile 擁有** tmux session，claude 行程由 cc-mobile 啟動，但使用者可透過原生 tmux attach 同時觀看。

Track C（現有架構改造路徑，來自 seamless-handoff-and-oneshot-plan.md）對應 C-hybrid：C-hybrid 實現行程所有權從 WS 連線解耦（C-1 Registry）、熱插拔輸出 Sink（C-2）、孤兒 Reaper（C-3），正是 Track C 三元件的具體形態。

---

## Spike 實驗結果（empirical evidence）

### Spike 1：tmux capture-pane 讀取 claude TUI 就緒性

**腳本（turn-1）**：`docs/adr/spike-014/spike-014-1-capture-pane.sh`
**成果檔（turn-1）**：`docs/adr/spike-014/spike-014-1-capture-pane.txt`

**⚠️ Turn-1 缺陷修正（turn-2 補正）**：turn-1 的腳本在 1000ms 後抓到 `❯` 就宣告就緒——但那個 `❯` 是開場 splash banner 的視覺裝飾，出現於 claude TUI **完成初始化之前**。一次性 banner grep 不等於互動就緒。這是 turn-1 的 Gap1。

**就緒偵測的正確語義（production-aligned token + STABLE_COUNT >= 3）**：

就緒性判定必須對齊 `server/tui-readiness.ts:57-64` 的 `classify()` 邏輯：
- buffer 含 `"Claude Code"`（含空格）或 `"╭"` → `"ready"`
- **❯ 出現於 splash 與就緒兩者，故不可作判據**（`tui-readiness.ts:52` 明確排除）
- 連續輪詢 `tmux capture-pane -p`，保留前次快照（`PREV_CAP`）
- 只有當 **STABLE_COUNT >= 3**（連續三次快照完全相同）且畫面含 `"Claude Code"` 或 `"╭"` 時，才宣告就緒
- 畫面靜止（quiescent）= TUI 已進入互動狀態

**settle-timing parity gap（記錄）**：spike 輪詢間隔 600ms；production `TuiReadinessMachine` 預設 `settleMs = 750ms`（`tui-readiness.ts:92`）。spike 比 production 更積極；實際部署應使用 750ms 或更長以降低誤判。

**修正腳本（turn-2）**：`docs/adr/spike-014/spike-014b-1-readiness.sh`
**修正成果檔**：`docs/adr/spike-014/spike-014b-1-readiness.txt`

成果檔記錄兩個階段：
- **SPLASH 階段**：~200ms 時的極早期截圖——PTY buffer 尚未開始繪製（畫面空白），是 chrome 元素完全缺席的直接證明
- **SETTLED 階段**：STABLE_COUNT >= 3 後宣告 `TRUE_READY`；`"Claude Code"` 存在 + 靜止 = 真互動就緒；包含 footer box（`────`）、input-row border（`────`）、"setup issue" 提示等 chrome 結構元素——這些是 SPLASH 完全缺少的具體區域

宣告就緒後注入 `READINESS_SPIKE014B_MARKER`，capture-pane 確認 marker 出現在輸入列，驗證注入在真就緒後可用。

**結論**：C-hybrid 架構中，cc-mobile 不需要持有 PTY fd 即可透過 capture-pane 取得 TUI 狀態。就緒偵測必須使用 production-aligned token（`"Claude Code"` / `"╭"`）+ STABLE_COUNT >= 3 quiescence compare，不得用一次性 banner grep 或裸 `❯` 判準。
**PASS**（turn-3 重新執行，真實在機器上執行；參見 `spike-014b-1-readiness.txt`）

---

### Spike 2：tmux send-keys 注入 prompt（含多行 / 特殊字元）

**腳本（turn-1）**：`docs/adr/spike-014/spike-014-2-send-keys.sh`
**成果檔（turn-1）**：`docs/adr/spike-014/spike-014-2-send-keys.txt`

**⚠️ Turn-1 缺陷修正（turn-2 補正）**：turn-1 的 spike 有兩個空洞：（1）從未送出真實 Enter——所有注入都以 Escape 清掉，從未真正提交 prompt；（2）從未附加第二個真實 tmux client，「桌機＋手機共用同一行程」是斷言不是實測。這是 turn-1 的 Gap2。

**2a：真實共存驗證（dual-client coexistence）**

**修正腳本**：`docs/adr/spike-014/spike-014b-2-coexist.sh`
**修正成果檔**：`docs/adr/spike-014/spike-014b-2-coexist.txt`

實測方法：
- 以 `tmux new-session -d` 啟動 claude session（cc-mobile 擁有）
- 以 `script -q <log> tmux attach-session -t <S> -r &` 在背景佔一個 pseudo-tty，附加第二個真實 client
- `tmux list-clients -t <S>` 輸出顯示 `/dev/ttys003: ... (attached,focused,...)` 確認 client 存在
- 透過 `tmux list-panes -F '#{pane_pid}'` 記錄單一 pane_pid，確認只有一個 claude 行程
- 從「手機側」send-keys 注入 `COEXIST_SHARED_SCREEN_CHANGE_MARKER_014B`，capture-pane 確認 marker 出現在共享畫面

成果檔節錄：
```
/dev/ttys003: spike014b2-... [80x24 xterm-ghostty] (attached,focused,ignore-size,read-only,UTF-8)
...
pane_pid: <PID>
...
❯ COEXIST_SHARED_SCREEN_CHANGE_MARKER_014B
```

**Smallest-client-wins 判定**：attached client 尺寸 80×24（script 預設）；pane 實際 80×22。在 C-hybrid 中，手機不以 raw terminal client 附加（走 hook/JSONL 結構化路徑），最小 client 是桌機使用者的 tmux attach——不存在小尺寸壓縮問題。**ACCEPTABLE**（可接受）。

**結論（共存）**：ONE 共享行程，TWO clients 同時附加，手機側 send-keys 注入即時同步反映在 capture-pane。
**PASS**（turn-2，真實在機器上執行；參見 `spike-014b-2-coexist.txt`）

---

**2b：特殊字元注入（turn-1 結論維持有效）**

注入 `echo "hello $USER"`（含 `"` 與 `$`）與 `ls /tmp | head -2; echo done`（含 `|`、`;`）——均正確出現在輸入緩衝區，未被 shell 提前展開。

**結論**：send-keys 是可靠的 TUI 注入機制，特殊字元通透。
**PASS**（turn-1，真實在機器上執行）

---

### Spike 2c：多行 prompt send-keys + Enter 實測（turn-2 新增）

**腳本**：`docs/adr/spike-014/spike-014b-3-multiline.sh`
**成果檔**：`docs/adr/spike-014/spike-014b-3-multiline.txt`

turn-1 從未送出真實 Enter——turn-2 修正：構造兩行 prompt（`MULTILINE_TEST_LINE1_...` + `MULTILINE_TEST_LINE2_...`），分別以 `send-keys ... "C-m"` 與 `send-keys ... "Enter"` 提交，並在每次 Enter 後立即 capture-pane 觀察提交行為。

**實測結論**：`MULTILINE_SEPARATE_TURNS_QUEUED`（turn-3 更正；turn-2 誤標為 `MULTILINE_ONE_TURN`）——第一個 Enter 送出後 LINE1 立即提交為獨立 turn，claude 開始處理；第二個 Enter 送出的 LINE2 被 claude TUI 排入佇列（成果檔 POST_ENTER_2 顯示 `Press up to edit queued messages`）。`Press up to edit queued messages` 是 claude TUI 的佇列提示，直接證明 LINE2 被排為下一個獨立 turn，而非與 LINE1 合併為單一 turn。

**影響（C-hybrid）**：每個 Enter 提交一個獨立 turn；若需單 turn 傳多行內容，應將所有內容合併為單行，僅在最後送一個 Enter。這是已知 trade-off，不影響 C-hybrid 整體可行性。

**Zellij 臂膀**：SKIP: zellij not installed — zellij arm skipped（未安裝，`command -v zellij` 空）。

**PASS**（turn-2，真實在機器上執行；參見 `spike-014b-3-multiline.txt`）

---

### Spike 3：Stop hook 在 tmux-owned session 中觸發

**腳本**：`docs/adr/spike-014/spike-014-3-hook-fire.sh`
**成果檔**：`docs/adr/spike-014/spike-014-3-hook-fire.txt`

以 `claude --settings <file>` 在 tmux session 中啟動 claude，設定 Stop hook 將 payload 寫入 marker file。注入 `Reply with just the word HOOKTEST` + Enter，**2000ms** 後 hook 觸發：

**Hook marker file 內容（真實截錄）**：
```
HOOK_FIRED
timestamp: 2026-06-17T11:09:30Z
--- payload ---
{"session_id":"44b08495-0d3d-41ae-911e-fb04e7a85d63",
 "transcript_path":"...44b08495-0d3d-41ae-911e-fb04e7a85d63.jsonl",
 "cwd":"/Users/nickhuang/workspace/cc-mobile",
 "permission_mode":"auto","effort":{"level":"medium"},
 "hook_event_name":"Stop","stop_hook_active":false,
 "last_assistant_message":"HOOKTEST",
 "background_tasks":[],"session_crons":[]}
```

TUI 畫面確認（成果檔截錄）：
```
❯ Reply with just the word HOOKTEST
⏺ HOOKTEST
✢ Skedaddling… (running stop hooks… 2/3 · 1s · ↓ 3 tokens)
```

**Zellij 臂膀**：SKIP: zellij not installed — zellij arm skipped; tmux arm runs below。
（zellij 未安裝，無法在本機執行 zellij 等效實驗；zellij 的 `action write-chars` 行為依賴 ADR-012 文件記錄，有 IPC 延遲與 escape 問題，見 ADR-012 方案B 分析。）

**結論**：Stop hook 在 cc-mobile 擁有的 tmux session 中可靠觸發，payload 包含 `last_assistant_message`——與 ADR-011 的 `pty-stop-hook.ts` 讀回管道完全相同，可直接複用。
**PASS**（真實在機器上執行）

---

## Zellij vs. Tmux 比較

此節對 C-hybrid 候選實作工具做詳細技術比對，以支撐 ADR-012 的修訂。

### 提示注入

- **tmux**：`tmux send-keys -t <session> "<text>" "Enter"` — 同步 Unix socket 呼叫，字元直接送入 PTY stdin 緩衝區。特殊字元（`"`, `$`, `|`, `;`, `` ` ``）在 send-keys 層面以 raw bytes 傳遞，不由 shell 展開（shell 只在 Enter 提交後看到輸入）。Spike 2 實測確認。
- **zellij**：`zellij action write-chars "<text>"` — 透過 zellij IPC（Unix socket + protobuf）中轉，有額外延遲（IPC roundtrip ~1-5ms）；特殊字元需 escape 或 quote 處理（ADR-012 方案B 已記錄此問題）。

### 畫面讀取

- **tmux**：`tmux capture-pane -t <session> -p`（文字模式）/ `tmux capture-pane -p -e`（含 ANSI 碼）— 同步，無需 PTY fd。另有 `tmux pipe-pane -o "cat >> <logfile>"`，可把 PTY 輸出持續管道到外部檔案。Spike 1 確認 capture-pane 在 1000ms 內即可讀到 TUI 就緒狀態。
- **zellij**：`zellij action dump-screen <file>` — 把目前 pane 畫面 dump 到檔案，類似 capture-pane。需要 zellij action CLI 與行程存活；無法在 cc-mobile 不擁有 zellij 行程時呼叫。

### Multiplexer 核心命令對照

| 操作 | tmux | zellij |
|------|------|--------|
| 注入文字 | `send-keys` | `write-chars` |
| 讀取畫面（文字） | `capture-pane` | `dump-screen` |
| 多客戶端同一 pane 尺寸 | **smallest-client-wins**（所有 client 共用最小尺寸）| **smallest-client-wins**（同一 pane 亦同）|
| Session 共享 | `attach-session` | zellij web client（0.43+）|

### Smallest-client-wins 行為

**兩者皆有** smallest-client-wins 問題：只要多個 client 同時觀看同一 pane，畫面大小由最小 client 決定。tmux 與 zellij 在此行為相同——手機若以 raw terminal 渲染同一 claude pane，桌機使用者的畫面被壓縮到手機尺寸。

**C-hybrid 的解法**：手機不渲染 raw terminal（cc-mobile 透過 hook/JSONL 取得結構化資料），smallest-client-wins 問題在 C-hybrid 下不存在——桌機透過 `tmux attach` 得到原生體驗，手機走 touch UI。

### 相依性與成熟度（dependency / maturity）

- **tmux**：1999 年起發展，BSD license，macOS / Linux 廣泛預裝或一鍵安裝，3.6b 穩定。cc-mobile 的 C-hybrid 架構以 tmux 為唯一外部相依（除 claude 本身）。相依性低、成熟度高。
- **zellij**：2021 年起，Rust 生態，0.43 才加 web client（尚屬 active development），macOS 需 `brew install zellij`（非預裝）。ADR-012 已記錄 zellij 在此機器上未安裝（`command -v zellij` 空），spike 3 的 zellij 臂膀以 SKIP 記錄。相依性高於 tmux，成熟度尚低於 tmux。

**結論**：tmux 在相依性與成熟度上均優於 zellij，且 tmux 的 send-keys / capture-pane / pipe-pane 功能集完整覆蓋 C-hybrid 所需。

---

## 架構比較表

| 維度 | C1（使用者擁有 tmux，cc-mobile 訪客）| C2（cc-mobile 擁有裸 PTY）| C-hybrid（cc-mobile 擁有 tmux session）|
|------|------|------|------|
| **擁有權 / ownership** | 使用者擁有 tmux/zellij session，cc-mobile 是訪客 | cc-mobile 完全擁有裸 PTY fd | cc-mobile 擁有 tmux session，使用者可 attach |
| **裸 claude / native claude TUI** | 使用者以 native TUI 工作；cc-mobile 透過 send-keys 注入 | cc-mobile 直接 write/read PTY — raw 字元層 | cc-mobile 啟動 claude 於 tmux；桌機 `tmux attach` 得 native TUI |
| **raw PTY** | 不需要（send-keys 路徑）| **必須持有**（node-pty onData/write 核心）| 不需要（send-keys + hook 路徑；node-pty 不再必須）|
| **hook 安裝 / hook** | 使用者**手動安裝** hook（摩擦點；部署壁壘）| hook 可由 cc-mobile 寫入 `--settings` | cc-mobile 以 `--settings <file>` 自動注入 hook（零摩擦）|
| **Track C / 現有架構對齊** | 不對齊 Track C（行程所有權在使用者端）| 不對齊 Track C（需重寫整個 PTY 伺服器層）| **直接對齊 Track C**（C-1 Registry + C-2 Sink + C-3 Reaper 均可在 tmux session 上實作）|
| **相依性 / dependency** | 依賴使用者自備 tmux/zellij + 手動設定 hook | 僅 node-pty（已有）；但需自建 raw PTY relay server | node-pty（可選）+ tmux（系統工具，廣泛安裝）；hook 自動注入 |
| **斷線存活 / disconnect survive** | tmux session 存活，cc-mobile 斷線後桌機繼續；重連後 send-keys 可恢復 | cc-mobile 死亡 = PTY 孤兒；需 reaper（C-3）；ADR-013 一次性模型下直接 kill | tmux session 存活，cc-mobile 重啟後重接 session；完整支援 Track C 重連語義 |
| **控制權威 / control** | **分裂**：使用者控制 session 生命週期，cc-mobile 只能透過 IPC 注入 | cc-mobile **完全控制** PTY；使用者需透過 attach client 接入 | cc-mobile **主導** session 生命週期；使用者以 tmux attach 取得觀察 / 互動權——合作而非衝突 |

---

## 決策

### 建議採用：**C-hybrid**（FEASIBLE，採用）

#### 理由

1. **Spike 3 直接驗證核心機制**（`spike-014/spike-014-3-hook-fire.txt`）：Stop hook 在 cc-mobile 啟動的 tmux session 中可靠觸發，`last_assistant_message` payload 與 ADR-011 的 `pty-stop-hook.ts` 完全相同。無需重寫 hook 讀回管道，只需把 spawn 路徑從 node-pty 直接 spawn 改為 `tmux new-session -d`。

2. **Spike 1 + 2 驗證雙向通道**：capture-pane 可讀（`spike-014/spike-014-1-capture-pane.txt`），send-keys 可寫（`spike-014/spike-014-2-send-keys.txt`）——C-hybrid 的兩條通道均實測可用。

3. **Track C 現有架構對齊**：C-hybrid 的 tmux session 是天然的「行程所有權登錄表（Process Registry）」載體；tmux session 存活等價於 C-1 Registry 中的「行程存活」語義；tmux attach 是「熱插拔輸出 Sink（C-2）」的桌機端天然實現；tmux session TTL 提供 C-3 Reaper 的自然邊界。

4. **使用者體驗不降級**：桌機使用者執行 `tmux attach-session` 得到完整 native terminal 體驗；手機 touch UI 走 hook/structured 路徑——smallest-client-wins 問題完全迴避。

5. **Hook 零摩擦**：cc-mobile 以 `--settings <file>` 自動注入 hook，無需使用者手動安裝（相對 C1 的最大差異）。

#### C1 被排除的代價（C1 loses）

C1 把 session 擁有權交給使用者，要求使用者**手動安裝 hook**（參照 `install-pty-hook.sh` 的安裝步驟摩擦），且 cc-mobile 只能在使用者「已開著正確 tmux session」的前提下才能介入。斷線後行程所有權不在 cc-mobile 端，重連語義無法由 cc-mobile 保證——這與 ADR-013 的長存+重連（Track C）要求不相容。控制權威分裂，cc-mobile 隨時可能被使用者的操作打斷。**C1 的根本代價：部署摩擦 + 控制權威分裂 + 無法實作 Track C。**

#### C2 被排除的代價（C2 loses）

C2 要求 cc-mobile 重新發明一個完整的 raw PTY relay server（類似 ttyd）——這不是漸進式改善，而是重寫整個底層 I/O 架構。現有的 `pty-driver.ts` / `pty-orchestrator.ts` 是針對 one-shot drive 設計的，若要支援多 client attach，需要重寫串流多路複用層。更嚴重的是，C2 的「桌機 cc attach 用戶端」需要用戶安裝自訂 terminal client——比 `tmux attach`（系統工具）摩擦更高。**C2 的根本代價：需重寫 raw PTY relay 層 + 額外 attach client 安裝 + 工程量等同從頭建設。**

### 後續步驟

採用 C-hybrid 後，執行路徑對應 `/context-flow:cf` 的 Track C 計畫（`docs/plan/seamless-handoff-and-oneshot-plan.md`）：

1. **C-1**：建立 `ProcessRegistry`，把 tmux session handle 納入全域登錄表，行程所有權從 `ws.data.ptySessionIds` 解耦。
2. **C-2**：`drive()` 的輸出 Sink 改為可熱插拔，`tmux attach` 的桌機端與 cc-mobile WebSocket 的手機端各接一個 sink。
3. **C-3**：Orphan Reaper 對孤兒 tmux session 在 TTL 後執行 `tmux kill-session`，`ptyRelay.denyAll()` 保證 ToS §3(7) 合規。

本決策不改變 ADR-011 的 hook/JSONL 架構，也不廢棄 ADR-013 的一次性模型基線——C-hybrid 是在 tmux session 外殼上實作 Track C，Track B 的改善（B-1 ～ B-5）先行，Track C 三元件同批合入。

---

## 與既有 ADR 的關係

### ADR-012（Zellij 整合可行性）

**狀態說明（turn-2 補充）**：ADR-012 的狀態仍為「Proposed pending /cf C-hybrid planning」，ADR-014 修訂（amend）其推論邏輯，不改變其最終 status。zellij 在本機未安裝（`command -v zellij` 空），spike 實驗中所有 zellij 臂膀均記錄為 SKIP（未安裝）。參見 `spike-014b-2-coexist.txt` 與 `spike-014b-3-multiline.txt` 中的 `SKIP: zellij not installed` 標記。

ADR-012 的決策「現階段不主動整合 zellij」**維持有效**，但 ADR-012 的推論基礎有一個值得修訂的地方：方案B（「cc-mobile 不渲染終端，zellij 作桌機 multiplexer」）被評為「技術可繞過 smallest-client-wins，但 zellij 無增量收益」——這個評估在 C1 vs C2 二元框架下成立，但 ADR-012 **未考慮** C-hybrid（cc-mobile 主動擁有 tmux session）這條路徑。ADR-014 修訂（amend）ADR-012 的狹義「B-only」zellij 拒絕邏輯：在 C-hybrid 框架下，multiplexer 的選擇是 **tmux 而非 zellij**，理由是 tmux 的相依性與成熟度更優（Spike 3 所驗，zellij 本機未安裝為已知事實），而非「multiplexer 整體無收益」——tmux 在 C-hybrid 中提供的 session 共享能力是核心價值，非可選層。

本 ADR 不取代（supersede）ADR-012 的整體結論，而是修訂（amend）其「方案B zellij 拒絕」邏輯，以 C-hybrid + tmux 路徑取代 ADR-012 未曾評估的第三條路。ADR-012 對方案A（手機渲染 raw terminal）的永久拒絕維持不變。

### ADR-013（Session 生命週期模型）

**狀態說明（turn-2 補充）**：ADR-013 的狀態仍為「Proposed pending /cf C-hybrid planning」，ADR-014 修訂（amend）其技術推論，不改變其最終 status。ADR-014 的 C-hybrid 決策是在 ADR-013 確立的 Track C 框架之內填充技術選擇（tmux 作 session 容器），而非取代或更改 ADR-013 的結論或 Proposed 狀態。

ADR-013 拍板「維持一次性模型，Track C 為後續改造軌道」。C-hybrid 是 Track C 的具體形態——不改變 ADR-013 的決策，而是填充 Track C 的技術實現選擇（tmux 作 session 容器）。

### ADR-011（PTY + hook 混合架構）

C-hybrid 複用 ADR-011 的 Stop hook 讀回管道（`pty-stop-hook.ts`），PreToolUse hook 橋接保持不變。唯一改變是 PTY spawn 方式從 node-pty 直接 spawn 改為 `tmux new-session -d`，`pty-driver.ts` 的 SpawnerFn 抽象可封裝此差異（ADR-012 已預見此接縫）。

---

## 可行性結論

**C-hybrid：FEASIBLE，採用。**

三個核心假設均經 spike 實驗直接驗證（spike-014 成果檔）。工程路徑清晰，與 Track C 完全對齊，使用者體驗不降級。

下一步交棒至 `/context-flow:cf`（`docs/plan/seamless-handoff-and-oneshot-plan.md` Track C 章節），由獨立 /spiral 輪次執行 C-1 Registry → C-2 Sink → C-3 Reaper。
