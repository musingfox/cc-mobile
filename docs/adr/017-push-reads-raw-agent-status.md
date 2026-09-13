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
