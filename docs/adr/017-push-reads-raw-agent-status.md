# ADR-017: 推播讀 herdr 的原始狀態，不等權限卡片

## Status

Accepted（2026-09-14）

## Context

### 背景

推播的 permission 觸發原本掛在 `native-permission` 上：畫面被解析成一張可回答的卡片之後，才通知手機。這條路徑是 #33 的產物，而 #33 立下的界線是「**只有可回答的問句才算問句**」：

- omp 的擴充在 API 失敗時也回報 `blocked`，那個畫面沒有 `Allow tool: ` 標記，是一個狀態而不是問句，刻意不舉卡片，改用 `agent_blocked_notice` 公告一次。
- claude 的首次執行工作區信任對話被回報成 `idle`，用 `agent_attention_notice` 公告，完全不進權限流程。
- 明確已知但不是 `{claude, omp}` 的種類，在 `server/herdr/backend.ts` 的 `permissionAppliesTo` 就被擋掉。

這一套的理由是實在的：在沒有解析器看得懂的畫面上，連 Cancel-only 的退路都等於猜那個鍵會做什麼。

`push-state-driven` 這一輪要把推播時機整體改由 herdr 的 `agent_status` 驅動。`done` 走合併窗口那半沒有爭議；有爭議的是 `blocked` ——繼續等卡片，還是讀原始狀態。

### 已確認事實（查證日期：2026-09-13）

- **「herdr 未判種類的 pane 不舉卡片」是錯的。** `permissionAppliesTo("blocked", undefined)` 回傳 `true`，且 `server/herdr/backend.test.ts` 釘住這個行為——absent 與 empty 都當作「herdr 還沒說」而放行。規劃初期把它列進「今後才會開始推播」的集合，是誤判。
- **今天靜默、改動後才會推播的正確集合是四類**：明確已知但非 claude/omp 的種類；omp 的 `blocked` 但畫面無法解析；`client.paneRead` 自己丟出例外（`readPrompt` 回 `undefined`，無卡片也無推播，這一條任何文件都沒寫過）；以及指紋相同的重複 `blocked`。
- **推播介面從來沒用過卡片獨有的資訊**：`backend.ts` 早已丟棄 `native-permission` 傳出的 `origin`。

## 決策

**`blocked` 的推播改讀 herdr 回報的原始 `agent_status`，不再等卡片。**

`server/herdr/pane-events.ts` 新增 `onAgentStatus`，把每一筆原始狀態觀察交給推播端；`native-permission` 的 `onPermissionPrompt` 選項、它的呼叫點與釘住它的測試一併刪除——在新設計下沒有任何消費者，留著只會邀請第二條推播路徑。

**#33 對卡片本身的裁決不動。** 手機上看到什麼、哪些畫面可以按、哪些只會公告一次，全部維持原狀。改的只是「什麼時候震動」。

### 為什麼選這個方向

使用者在代價擺在桌上的情況下選了它。理由是另一邊的失敗模式更糟：**解析器漏看一個真的問句時，等卡片的設計會讓人完全不被通知**——agent 卡在那裡，手機安安靜靜，而人以為它還在跑。讀原始狀態則保證「這個 pane 需要你」這件事一定送得出去，即使送出去之後手機上沒有可按的東西。

一個狀態一條觸發，也讓新的「一個 blocked episode 只震一次」的閂不必再跟它要取代的指紋去重協調。

### 落選方向

- **維持卡片觸發**：保住 #33 的界線，但接受解析器漏看的真問句不通知任何人。這是提案時的建議方向，被使用者否決。
- **兩條觸發並存，另加 `onBlocked`**：改動最小，但同一個狀態有兩條觸發，且新的閂要跟指紋去重協調——它本來就是要取代後者的。

## 風險

**最可能先失效的一條**：無法回答的 `blocked` 如果在實務上很常見，推播會反覆把人叫回一個答不了的畫面。那時要恢復的就是 #33「卡片才算問句」這條界線——**但要恢復的是推播這一半，不是卡片那一半**，兩者在這次之後是分開的。

實際被這類畫面震到幾次，是判斷這個決定對錯的唯一依據，且只能從實機使用得到。

## 與既有 ADR 的關係

### ADR-015（herdr 取代 tmux 作為持久化終端層）

延續，不衝突。ADR-015 §2026-08-02 立下的是「permission 由 herdr 的 `blocked` 起頭，螢幕解析出選項，`send_keys` 回答」。這裡動的是同一條鏈上更前面的岔路：推播從哪一節取用。鏈本身沒變。

### ADR-003（permission mode 預設）

已被推翻，不再相關。cc-mobile 自己不產生任何 agent 設定，agent 的許可姿態是它自己的設定。

## 結論

推播讀 herdr 的原始 `blocked`，卡片仍照 #33 的規則決定要不要舉。代價是明知選的：會有震動對應不到可按的東西。換到的是另一件事——沒有任何一個真的問句，會因為解析器看不懂而讓人完全不知道。

落地於 `cf/push-state-driven`；狀態模型、45 秒合併窗口與量測過程記在 `docs/milestones/push-state-driven.md`。

## 2026-10-03 增修：手機正在看 app 時不推播（push-foreground-suppress）

### 背景

推播的範圍只有 phone-last，不看手機此刻是不是正開著 cc-mobile，所以人常常正盯著同一個畫面時被震。抑制只能做在伺服器端：iOS 會撤銷「收到推播卻不顯示通知」的訂閱，service worker 不能自己把它吞掉。

### 決策

**伺服器以裝置為單位判斷「此刻是否前景」，並在推播真正送出的那一刻問。**

- 前景的證據是一條活著的 WS 連線，它帶著該裝置的 `?device=`，而且頁面最近一次回報 `visible` 距今不到 25 秒（`FOREGROUND_FRESH_MS`）。紀錄以連線為單位保存，舊連線晚到的 close 不會抹掉新連線剛回報的狀態。
- 新的 client→server 訊息 `visibility` 帶 `{state: "visible" | "hidden"}`。頁面在連線時、每次 `visibilitychange` 時回報，可見期間每 10 秒再回報一次。
- 訂閱以 `/api/push/subscribe` 的 `device` 欄位連到裝置，正規化規則與 `?device=` 完全相同（trim、截 200 字）。沒帶 `device` 的訂閱永遠照送，跟今天一樣。
- 判斷放在 sender，對每個訂閱在送出前各問一次：turn 是窗口到期的那一刻，`blocked` 是立刻。
- 被抑制的推播在 attempt log 寫一行，`status: null`、`reason: "foreground"`，外加 `skipped: true`。送出與失敗的行都不會有這個欄位。

### 兩個判定為什麼在不同時刻取值

範圍判定（phone-last）在 `done` 抵達時取值，前景判定在窗口到期時取值，兩者可以不一致，這是刻意的。範圍問的是「誰叫的這件工作」，屬於過去，45 秒後再問可能已經被下一個回合改寫。前景問的是「現在要不要打擾」，屬於當下，人可能在這 45 秒內拿起或放下手機。所以範圍決定**哪些 pane** 被通報，前景決定**哪台手機**會震。

### 偏向送出，以及「不補送」

- 判定拿不到或過期時一律送：沒有回報、回報超過 25 秒、連線已斷、沒聽過的裝置、沒帶 `device` 的訂閱。多震一次的代價小於一個沒人聽到的 `blocked`。
- 被抑制的推播是**丟掉，不是延後**。窗口到期時若所有裝置都在前景，那一則合併通知就不送，之後也不補送：待發的 pane 在派送前已經清空。`blocked` 被抑制後，手機放下也不會再送，因為一個 blocked episode 只送一次。人當時正看著 app，這是可以接受的，但它必須寫明，否則會被當成漏送。

### 超出票面的一項：可見期間的心跳

票面只寫「連線時與每次變化時回報」。只靠這兩個時機，「判定過期」沒有定義：手機鎖定時 `hidden` 那一幀可能送不出去，而 socket 要等 Bun 的 idle timeout（`WS_IDLE_TIMEOUT_SECONDS = 240`）才會關。這段期間伺服器會一直以為手機在前景，而被抑制的 `blocked` 不會重送。心跳把這個誤判壓到最多 25 秒。`2 × VISIBILITY_HEARTBEAT_MS < FOREGROUND_FRESH_MS` 由 `client/__tests__/ws-service-visibility.test.ts` 釘住。

### 落選方向

- **在 service worker 端吞掉**：iOS 會撤銷訂閱。
- **在 `done` 入列時問前景**：會用 45 秒前的狀態決定現在要不要打擾。
- **不設期限，只靠 WS 斷線**：鎖定後可能錯誤抑制長達數分鐘。
- **skip 沿用 `status: null` 加 `reason`**：那正是送出失敗的樣子，讀的人得解析 `reason` 才分得出來。
- **skip 寫成 `status: "skipped"`**：`status` 是推播服務自己的回應，沒有人回應時就該是 null。

### 風險

- 裝置名稱可以在 Settings 改。兩台設成同一個名字會互相抑制；改名後到下次開 app 重新上傳訂閱之前，名字對不上，結果是照送。
- 25 秒與 10 秒是斷言，不是量出來的。實機上鎖定後 `hidden` 送不出去的頻率，決定這個期限要不要再縮。
