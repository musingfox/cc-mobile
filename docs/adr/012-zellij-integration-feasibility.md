# ADR-012: Zellij 整合可行性評估

## Status

Proposed（2026-06-17）

## Context

### 背景

ADR-011 確立了 PTY 驅動互動式 `claude` TUI 的混合架構：PTY 送指令、`PreToolUse` hook 把關 permission、JSONL tail 讀對話紀錄。cc-mobile 的核心價值是**觸控最佳化 PWA**——把終端機的 permission prompt 轉成按鈕、slash command 轉成選單，而非在手機上裸呈現一個終端畫面。

Zellij 0.43 引入了內建 web client，讓任一瀏覽器可透過 WebSocket 連上 zellij session，技術上可讓桌機開著 zellij 跑 claude，而手機從瀏覽器同時加入。此評估判斷 zellij 是否能為 cc-mobile 帶來架構上的價值，還是反而與現行設計衝突。

### Zellij web client 事實基礎（來源：2026-06-17 查證）

Zellij 0.43 ships 一個內建 web client：每台機器起一個 web server，每個 session 對應一個 URL（`https://host/session-name`），透過雙 WebSocket channel 運作——一條負責 ANSI render + STDIN 傳遞，另一條負責 resize/config 控制；token 認證以 SQLite 儲存 hashed token，HTTP-only cookie 傳遞；非 localhost 環境強制 HTTPS。

**Multiplayer 特性**（來源：`github.com/zellij-org/zellij` issue #1739、discussion #5066；`poor.dev/blog/building-zellij-web-terminal`；`zellij.dev/news/multiplayer-sessions`）：多個 client 可同時連入同一 session，各自有獨立游標；client 聚焦在**不同** pane/tab 時尺寸可各自獨立，但只要多個 client 同時檢視**同一 pane/tab**，就會發生 **smallest-client-wins（最小客戶端勝出）**：所有人的畫面被縮到尺寸最小的那個 client 的維度。手機螢幕遠小於桌機，只要手機+桌機共用同一個 claude 窗格，桌機使用者的畫面就會被手機尺寸壓縮，終端佈局全壞。

### cc-mobile 架構現況（ADR-011）

ADR-011（與 ADR-010 計費/§3(7) 約束共存）決定：

- PTY 驅動互動 TUI 走訂閱互動桶，與 ADR-010 確立的計費限制**並存**（不取代計費問題的技術答案，而是繞開它）。
- `PreToolUse` hook 攔截 tool 呼叫，推送至手機讓使用者點選 allow/deny，再回傳 `permissionDecision`。
- JSONL tail 提供結構化對話紀錄。
- cc-mobile **不在手機上渲染終端畫面**；hook/JSONL 路徑使架構完全與終端機渲染層解耦。

---

## 整合方案分析

### 方案A：手機直接渲染 zellij raw terminal（web client / xterm.js）

手機瀏覽器透過 zellij 0.43 web client 直接連入 zellij session，在手機上渲染一個可互動的終端畫面（ANSI raw terminal render）。

**取捨與代價：**

1. **smallest-client-wins 破壞桌機體驗**：桌機同時 attach 到同一個含 claude 的 pane 時，手機螢幕尺寸（約 375px 寬）成為全域上限，桌機終端佈局被壓縮到手機大小，日常使用難以接受。
2. **ANSI raw terminal rendering 對立於觸控化 UI**：cc-mobile 的核心價值是將終端機的 permission prompt 轉成觸控按鈕、slash command 轉成 tap-friendly 選單；手機直接渲染 ANSI 終端畫面完全抹掉這個 UX 主張——使用者在手機上看到的是滿滿的 ANSI 控制碼與小字體的 raw terminal 輸出，而非結構化的 permission card 或 tool status bubble。
3. **缺點**：touch keyboard 與終端機滾動（xterm.js 觸控捲動）在手機瀏覽器上衝突；copy-paste 體驗差；portrait/landscape 切換觸發 resize → 再次 smallest-client-wins。
4. **zellij 為可選層**：cc-mobile 自己擁有 PTY（node-pty）；zellij 在此方案僅增加一個 multiplexer 中間層，無任何功能收益，純粹代價。

**結論**：方案A 與 cc-mobile 的觸控 UI 價值主張根本衝突，且 smallest-client-wins 在手機+桌機共用窗格情境下不可迴避，不可行。

---

### 方案B：cc-mobile 不渲染終端 — zellij 作桌機 multiplexer，cc-mobile 走 hook/JSONL 側信道（共存架構）

Claude 在 zellij pane 內執行；桌機使用者以原生 zellij client attach（全尺寸，不受 smallest-client-wins 影響，因手機從不 attach 同一 pane）。**cc-mobile backend 完全不接觸 zellij 的 web client 或終端渲染層**，維持 ADR-011 的 hook + JSONL 架構——`PreToolUse` hook 把 permission 推送到手機讓使用者點選（tap-friendly 按鈕），JSONL tail 提供結構化對話串流。手機輸入若需送入，透過 `zellij action write-chars` 注入，而非透過 zellij web socket。

**取捨與代價：**

1. **架構複雜度增加但無必要性**：PTY 管理本就是 cc-mobile backend 的職責（ADR-011 的 `pty-worker.mjs` + `pty-driver.ts`）。若在 zellij 內跑 claude，cc-mobile 必須改成依賴 zellij 行程存在、且需 `zellij action write-chars` API 可用——增加一個外部行程相依，deploy 從「bun 一個行程」變成「bun + zellij」兩個守護程序。
2. **`zellij action write-chars` 非原生的 PTY write**：PTY 直接 write bytes 是同步且可靠的；`write-chars` 透過 zellij IPC，有額外延遲與 shell escape 問題（特殊字元、換行、Escape 序列）。缺點：對話中的 multiline prompt、特殊符號需要額外 escape 處理，原本 PTY driver 已解決的問題會重新浮現。
3. **Desktop attach 不衝突**：只要桌機以原生 zellij client 連入、手機完全不以 web client 渲染同一 pane，smallest-client-wins 問題確實可被迴避。但這代價是手機端**不再有任何終端視覺反饋**，只有 hook-driven 的結構化 UI——這其實正是 ADR-011 的現況，zellij 在此沒有增量收益。
4. **ToS §3(7) 姿態不變**：`zellij action write-chars` 同樣是自動化注入，不改變 human-in-the-loop 的必要性。

**結論**：方案B 技術可繞過 smallest-client-wins，但 zellij 在此架構中只扮演「cc-mobile 自有 PTY 的替代物」，帶來額外行程相依而無必要收益。cc-mobile 直接擁有 PTY 更簡潔。

---

## 可行性分析總結

**`**可行性結論**`: 條件式可行**

純技術層面：方案B 的共存路徑在技術上條件式可行——手機不渲染終端、hook + JSONL 繼續驅動觸控 UI、桌機以 zellij 原生 client 獲得 multiplexer 體驗，且避開了 smallest-client-wins 問題。

然而，「條件式可行」的條件是：**使用者有明確的桌機 zellij multiplexer 需求**（多 pane、session 管理、桌機 attach/detach），且願意在 deploy 時多維護一個 zellij 行程。若沒有這個明確需求，zellij 的引入只增加複雜度而無收益——cc-mobile 自有 PTY 已足夠驅動 claude TUI。

---

## Decision

### 決策

**現階段不主動整合 zellij**；但若使用者提出「桌機 multiplexer」的明確需求，方案B 的共存路徑是可追求的，不需架構重寫——其前置條件是 ADR-011 的 session 生命週期模型先拍板（長壽 session + 斷線重連），再由 `/context-flow:cf`（下一步）展開完整規劃。

理由：
1. cc-mobile 目前的 PTY 直接驅動（ADR-011）已能完成「送指令 + hook permission + JSONL 紀錄」，zellij 不帶來功能增量。
2. 引入 zellij 為外部行程相依，deploy 複雜度上升，且 `write-chars` IPC 路徑取代原生 PTY write 有迴歸風險。
3. 方案A（手機渲染 raw terminal）完全排除，因 ANSI raw terminal rendering 與 tap-friendly 結構化 UI 根本衝突，且 smallest-client-wins 在手機+桌機共用同一 pane 時無技術解。

### 開啟的門

- 若日後有「桌機開 zellij session，手機當遠端審核/控制端」的具體使用情境，方案B 不需大改 cc-mobile 核心架構即可追加：hook + JSONL 管道對 multiplexer 不感知（ADR-011 架構 multiplexer-agnostic）。
- Zellij multiplayer 的「獨立 pane 尺寸」特性可讓桌機使用者同時 attach 其他 pane（如監控 pane），只要手機不 join 同一 claude pane。
- 整合路徑留存，作為 `/context-flow:cf` 下一步的候選規劃項目。

### 關閉的門 / 代價

- 方案A **永久關閉**：在手機上以 raw terminal 渲染 zellij web client 與 cc-mobile 的觸控 UI 價值主張不可調和，any future revisit 必須先解決 smallest-client-wins 與 ANSI 渲染和 structured UI 的根本衝突。
- 不採用 zellij 意味著 cc-mobile 不提供 pane/tab multiplexer 能力；使用者若需要多 pane 工作流，須在 cc-mobile 之外自行管理（tmux、zellij 桌機端）。
- 若未來決定整合方案B，`pty-driver.ts` 的 PTY 直接 write 需改為透過 `zellij action write-chars` IPC，此為破壞性 API 替換，需完整 E2E 驗證。

---

## 後果

### 正面

- 架構維持 ADR-011 的 PTY 直接驅動，部署保持單一 Bun 行程，無外部行程相依新增。
- 決策釐清了「手機終端渲染」vs「觸控結構化 UI」的本質差異，防止未來以「zellij web client」為名的誤導方向。
- 為桌機 multiplexer 需求保留了條件式路徑，未來追加無需架構重寫。

### 負面 / 代價

- cc-mobile 本身不提供 pane multiplexer；「多工作 session 同時可見」的桌機需求需由外部工具（zellij、tmux）滿足，cc-mobile 僅管轄手機端的觸控審核介面。
- 方案B 若日後執行，`write-chars` IPC 路徑的特殊字元 escape 問題需納入 spike 驗證範圍，不可假設行為與原生 PTY write 相同。

### 與既有 ADR 的關係

- ADR-010（計費/§3(7)）：zellij 整合**不改變**計費桶選擇——無論 claude 是否在 zellij pane 內執行，互動 TUI 仍走訂閱互動桶，§3(7) human-in-the-loop 要求仍適用。兩者**共存**，zellij 僅為終端 multiplexer 層，不觸及計費路徑。
- ADR-011（PTY + hook 混合架構）：方案B 若執行，ADR-011 的 hook/JSONL 層保持不變，**共存**而非取代；唯 PTY spawn 方式從 cc-mobile 直接 spawn 改為依賴既有 zellij session，`pty-driver.ts` 的 SpawnerFn 抽象可封裝此差異。
- 本 ADR 為可行性判準，後續若推進方案B，須由 `/context-flow:cf` 展開完整規劃（下一步）。
