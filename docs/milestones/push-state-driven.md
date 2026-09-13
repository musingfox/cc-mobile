---
status: done
delivered: deeb3e5   # cf/push-state-driven 的程式碼末端；這份文件與 ADR-017 是它之後的一個提交。bun test 1915 pass / 0 fail，tsc 與 base 同為 26
depends: []
---

# 推播時機改由 herdr agent_status 驅動

## 這個里程碑交付什麼

推播的**時機**改由 herdr 的 `agent_status` 決定，取代 `onTurnSettled` / `onPermissionPrompt` 兩條自訂觸發：`blocked` 立刻發、`done` 走一個 45 秒的合併窗口、`idle` 永不觸發。同一個回合被算兩次的問題在 `server/herdr/pane-events.ts` 的來源修掉，不是靠窗口遮住，因此 transcript 的重複投遞一併消失。

**範圍與對象完全不動**：phone-last 的判定（`server/push/phone-driven.ts`）、每個訂閱各送一則的 fan-out（`server/push/sender.ts`）、固定通用 payload、service worker 契約、WS 協定、audit log 的六欄格式，全部維持原狀。這張票只改「何時發」。

起點是 vault 的 `pm/cc-mobile/tasks/push-state-driven.md`（2026-09-13，使用者回報「通知太頻繁」）。**那張票的根因段落是錯的，見下一節**；狀態表與範圍限制則照收。

## 前提修正（票上寫的與程式碼不符）

- **attempt log 上的成對不是雙發，是兩個訂閱。** `~/.claude-mobile/push-subscriptions.json` 有兩個 `web.push.apple.com` endpoint，`server/push/sender.ts:102-142` 每個訂閱寫一行 log，兩行相隔 150–300 毫秒。決定性證據：permission 也成對，而 permission 只走狀態改變分支（`server/herdr/pane-events.ts:301`，`:273` 早退擋掉未改變者）且 `server/herdr/permission/native-permission.ts:306` 指紋去重同一個 `blocked`——雙發理論做不出 permission 的成對。時間軸吻合：8/25、8/27 單行，8/28 起成對。
- **票上的頻率是兩倍**：07:05–07:30 的 22 行 ÷ 2 個訂閱 ≈ 25 分鐘 11 次派送。
- **票上的雙發機制本身是真的，但 log 上不可觀測。** stream 事件不帶 `state_change_seq`（`pane-events.ts:263-267`），`working → done` 打中 `:316-319` 推進 `status` 卻留下舊 `seq`，下一次 snapshot 看到 `status === previous && seqAdvanced && settled` 又打中 `:278-281`；它同時讓 `transcript.deliverTurn` 送兩次。log 沒有 paneId 也沒有 endpoint。
- 使用者已確認那兩個訂閱是**兩台裝置**，因此各收一則是正確行為，fan-out 不是噪音來源。
- **雙發是真的，但很稀有。** 09-12 07:05–07:30 那 22 行實測分佈為：1 單、8 對、1 三、1 四（`2026-09-12T07:09:48.398/48.604/49.114/49.323Z`）。兩個訂閱下，若每個回合都雙發應該處處是四行——只有一處。所以來源修補收掉的是一個真實但不常發生的 bug 與 transcript 的重複投遞，**不是使用者感受到的主要噪音**。
- **主要噪音是頻率本身**：25 分鐘約 11 次派送、每台裝置約 11 則通知。壓下它的是 `done` 窗口，不是雙發修補。票上「每個事件在手機上震兩次」是作者從（已被推翻的）雙發理論推出的推論，不是使用者的觀察；使用者回報的是「太頻繁」。
- **`idle` 今天分不出來**：`SETTLED_STATUSES = {"idle","done"}`（`pane-events.ts:132`），settled 回呼只帶 sessionId 不帶狀態。「idle 不發」需要狀態本身送達推播，不是加個判斷就有。

## 可以據以動工的形狀

- **狀態抵達推播**：`pane-events` 維持唯一狀態權威，把狀態隨 settled 通知帶出去。與「在來源修雙算」動到同一段，順手。
- **`blocked` → 立刻發、不進窗口**，觸發改為 herdr 回報的原始狀態，不再等 `native-permission` 舉起卡片。**這是使用者明知代價後的選擇**：自 #33 起刻意不舉卡片的畫面今後會震手機，而手機上沒有可按的東西。#33 對**卡片**的裁決不動。
  **實作階段更正**：原本寫「herdr 未判種類的 pane」屬於這一類是錯的——`permissionAppliesTo("blocked", undefined)` 回傳 true（`server/herdr/backend.ts:190-197`，`backend.test.ts:345,353` 釘住），未判種類的 pane 今天就會舉卡片也會推播。正確集合是：(1) 明確已知但非 claude/omp 的種類；(2) omp 畫面無法解析（`native-permission.ts:310`）；(3) `paneRead` 自己丟例外（任何文件都沒寫過）；(4) 指紋相同的重複 `blocked`。
- **重複的 `blocked` 只震一次**：原本擋重複的是 `native-permission.ts:306`，繞過卡片後失效。以 pane 為單位上閂，進入 `blocked` 發一次、離開才解除。
- **`done` → 45 秒窗口**，窗口內所有 settled 的 pane 合併成一則。payload 是固定通用字串（CLAUDE.md「Background Push」，穿越 APNs 的既有裁決），本就不指名 pane，合併不損失資訊。
- **窗口的取消由狀態本身驅動**：`idle` 既不發也不取消（`done` 被看過會衰減成 `idle`，那是同一個回合），其餘任何狀態都取消該 pane 的待發通知，下一次 `done` 開新窗口。
  **實作階段更正**：原本寫「到期檢查沒有開始新回合且現在沒在忙」，其動機是迴避「`done` 會不會在窗口內自己衰減」這個未量測的量。那個問題不成立——`pane-events.ts` 舊註解把 `done → idle` 說成「投遞後衰減」是錯的框架，herdr 沒有時間性衰減，`done` 的意思是「idle 且還沒被看過」，轉換由 focus 標記已看過驅動（上游 v0.9.0 socket-api 文件；CHANGELOG 0.4.5 加入、0.7.3 修 socket focus）。`done` 會一直是 done 直到有人 focus，所以窗口不需要任何防衰減設計。
- **雙算在來源根治**：事件路徑推進狀態時一併推進 `seq`，後續 snapshot 不再視為新的 settled。
- **驗收條件要改寫**：票上「一個回合在 attempt log 只留一筆」照字面不可能成立（一次派送 = 一個訂閱一行，兩台裝置就是兩行），正確說法是**一個回合只產生一次派送**。「多個 pane 併成一則」在 attempt log 上**無法驗證**——`AttemptRecord` 只有 `{ts,kind,host,status,reason}`，沒有 paneId。

## 刻意留給下一層的

- **attempt log 要不要帶 paneId**。沒有它，「合併成一則」沒有觀測面；但那六欄是 CLAUDE.md 明寫、測試逐字釘住的磁碟格式，加一欄是格式變更，且把「哪個 pane 造成推播」寫進一個刻意不記錄內容的檔案——獨立的隱私與格式決定。
- **前景抑制怎麼接窗口**（vault `push-foreground-suppress`）：到期那刻裝置在前景要怎麼算，窗口存在後才問得出來。
- **合併後的文案**（vault `push-meaningful-copy`）：一則通知可能代表多個 pane，「說出是哪個 session」被這一層限縮了。
- **`blocked` 噪音若真的發生怎麼收**：先照選定方向做，實際被無法回答的畫面震到幾次是下一層的輸入。

## 什麼會推翻這個結論

- **無法回答的 `blocked` 頻繁出現**——推播把人叫回答不了的畫面，那時要恢復的是 #33「卡片才算問句」的界線。本層明知風險而選，也是最可能先失效的一條。
- **那兩個訂閱其實是同一支手機**——雙發修掉後每個事件仍震兩次（同 `tag` + `client/public/sw.js:154` 的 `renotify: true`，取代時重新震動），症狀未解，`sender.ts` 的 fan-out 去重要回到桌上。
- **雙發修掉後 log 上的成對仍存在**——成對歸因於兩個訂閱是錯的，前提整段重查。
- **45 秒明顯不對**——可回頭的參數，但若必須調到 5 秒或 5 分鐘才合用，說明「窗口」不是對的工具。

輸掉的方向：**只在推播端去重**（改動最小，但 transcript 的重複留著，下一個不走窗口的觸發要再修一次）；**讓窗口併掉雙發**（窗口長度的巧合，不是修好）；**只有卡片才發 blocked**（保住 #33 界線，代價是解析器漏看的真問句不通知任何人）。

## 後續待辦

- vault 的 `pm/cc-mobile/tasks/push-state-driven.md` 根因段落已被推翻（成對是兩個訂閱的 fan-out，不是雙發），兩條驗收條件照字面不可驗，要同步改寫；`push-double-dispatch` 的 `blocked_by` 關係也要重判。
- `push-foreground-suppress` 與 `push-meaningful-copy` 的形狀都被這一層限縮了，見「刻意留給下一層的」。
- 45 秒是斷言不是推導出來的。實機用一週後回頭看，`TURN_PUSH_WINDOW_MS` 是具名常數，改它不需要結構變動。
