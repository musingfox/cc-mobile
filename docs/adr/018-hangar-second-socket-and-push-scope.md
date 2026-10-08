# ADR-018: 連機庫的第二個 herdr socket，連不上不退出，機庫內一律推播

## Status

Accepted（2026-10-08）

## Context

### 背景

派發出去的工作要集中在一個獨立的 herdr 具名 session，稱為機庫，名稱是 `fleet`。使用者平常操作的預設 herdr 稱為駕駛艙。這樣分開，是為了讓派發的 agent 不淹沒使用者的工作空間。設計與理由記在 vault 的 `pm/cc-plugins/docs/手機-obsidian-開-claude-code-session-評估與原型結果.md`「第二階段」一節。

機庫由 LaunchAgent `dev.musingfox.herdr-fleet` 常駐，socket 在 `~/.config/herdr/sessions/fleet/herdr.sock`。2026-10-07 重開機後驗證過：登入後它自己起來，裡面的 claude 能認證（vault `pm/cc-mobile/tasks/archive/hangar-launchd-service.md`、`pm/cc-mobile/docs/機庫重開機測試.md`）。

cc-mobile 今天只連一個 socket，路徑由 `HERDR_SOCKET_PATH` 決定，未設時是 `~/.config/herdr/herdr.sock`（`server/herdr/transport.ts:39-43`）。ADR-015 把 herdr socket 定為唯一的 trunk，這則 ADR 讓它變成兩條。

### 已確認事實（查證日期：2026-10-08）

- **只有啟動那一刻會退出。** `server/index.ts:15-20` 在 `listen` 之前呼叫 `verifyHerdrStartup`，失敗就 `process.exit(1)`。pm2 沒有重啟延遲，所以 2026-09-09 到 09-12 以及 10-01 出現崩潰循環。pm2 log 記到 3,550,439 次結束碼 1，error log 最後一段全是 `herdr daemon unusable ... connect failed`（vault 背景文件，「第二階段」的查證段落）。
- **啟動之後，事件訂閱失敗不會讓程序退出。** `pane-events.ts` 的 `start()` 不會 reject，訂閱失敗時仍然啟動輪詢（`server/herdr/pane-events.ts:466-505`）。執行期間 socket 整個消失時，其他請求路徑怎麼表現則**未驗證**。
- **連不上和協定不相容是兩種失敗。** `assertCompatible` 先 `ping`，再比對 `protocol`，不符就丟 `HerdrProtocolError`（`server/herdr/client.ts:109-118`）。上游曾經改過協定號，結果開機就失敗。
- **pane id 只在同一個伺服器內唯一。** 兩邊都可能有 `w1:p1`。伺服器和手機都把 session 鍵當成不透明字串，沒有任何地方解析它的結構。但手機用它當 localStorage 的鍵（`client/services/draft-persistence.ts:2`、`client/services/session-persistence.ts:98`），伺服器用它當上傳目錄名稱（`server/upload-manager.ts:13`）。
- **推播範圍今天是一個全域值。** `CC_MOBILE_PUSH_SCOPE` 只能是 `phone-last`（預設）或 `all`（`server/config.ts:91-96`）。`phone-last` 由 `server/push/phone-driven.ts` 判斷：只有最近一回合是 cc-mobile 送出提示的 pane 才推播。

## 決策

### 一、同時連駕駛艙和機庫兩個 socket，機庫 pane 的 session 鍵加前綴

- 駕駛艙的 socket 照舊由 `HERDR_SOCKET_PATH` 決定。機庫由新的環境變數 `CC_MOBILE_HANGAR_SESSION` 指定 herdr 具名 session 的名稱，socket 路徑是 `~/.config/herdr/sessions/<name>/herdr.sock`。**未設定就沒有機庫**，cc-mobile 的行為和今天完全一樣。
- 機庫 pane 的 session 鍵是 `<name>@<pane_id>`，例如 `fleet@w1:p1`。駕駛艙 pane 的鍵維持原本的 `w1:p1`，不加前綴。
- 分隔字元不能用 `:`，因為 pane id 裡已經有。也不能用 `/`，因為鍵會被當成上傳目錄名稱。
- `terminal_sessions` 同時列出兩邊的 pane。每一筆描述加上它屬於哪一邊，手機據此標示。

**理由。** 只給機庫加前綴，是因為手機已經用駕駛艙的鍵存了草稿和 session 狀態。兩邊都改鍵，這些資料會成為孤兒，而且還沒重新載入的舊版 bundle 送來的鍵會對不上。機庫是新的，沒有舊資料要保護。

機庫要另外打開開關，是因為開發機和沒有機庫的機器都會跑這個伺服器。如果預設就連 `fleet`，這些機器開機就會一直以為機庫離線，然後推播。

### 二、兩個 socket 連不上都不退出，機庫離線時推播

- 啟動時連不上駕駛艙或機庫，都不再 `exit(1)`。伺服器照常 `listen`，在背景重試連線，連上之後自動恢復，不需要重啟 cc-mobile。這是使用者 2026-10-08 的決定。
- **協定不相容仍然讓啟動失敗。** 對著一個講不同協定的 daemon 服務，比不服務更糟：每個請求都會在執行期以看不懂的方式失敗。
- 某一邊離線時，手機打開 app 就要看得出是哪一邊離線，例如 session 清單附帶離線狀態。具體形狀交給實作卡 `hangar-socket-connection`。
- **機庫**持續連不上一段寬限時間之後，推播一則「機庫離線」。一次離線只推一次，恢復時不推。寬限時間是 300 秒，由使用者 2026-10-08 審核時定下，草稿原本提的是 30 秒。它至少要比 LaunchAgent 的 `ThrottleInterval`（10 秒）長，herdr 正常重啟才不會被當成離線。
- **駕駛艙**離線只在 app 裡顯示，不推播。

**理由。** 崩潰循環的直接原因是啟動時連不上就退出，而當時連不上的是駕駛艙。只讓機庫不退出，問題並沒有解決。

機庫離線要推播，是因為派發出去的工作在使用者不在電腦前時執行，機庫倒了沒有人會看到。駕駛艙是使用者在電腦前操作的地方，倒了他自己看得到，推播只會在他已經知道的時候多震一次。這一點可以在 Accepted 之前推翻。

恢復時不推，是因為恢復之後被叫回 app 的人沒有事可做，而 app 本來就會顯示目前的狀態。

### 三、機庫內的 session 一律推播，駕駛艙維持原本的範圍

- 機庫裡的 pane 不經過 `phone-last` 判斷，`blocked` 和 `done` 一律進推播。
- 駕駛艙的範圍照舊由 `CC_MOBILE_PUSH_SCOPE` 決定，預設仍是 `phone-last`。
- 使用者在電腦前接手某個機庫 session 之後，它仍然在機庫，照樣推播。
- 推播的其他規則全部沿用：`blocked` 立刻送，`done` 進 45 秒合併窗口，前景抑制，以及推播只說專案名、不說工作內容。

**理由。** 機庫裡每個 session 都綁著一張卡，是使用者明確派出去的工作。「誰送了最後一則提示」這個問題在機庫沒有意義：使用者在電腦前插手，不代表他之後不想在手機上知道結果。

範圍跟著 socket 走，而不是跟著卡片，因為卡片和 session 的綁定還沒有實作（`launch-into-hangar`）。socket 是今天就讀得到的事實。

## 為什麼選這個方向

另一種做法是為機庫另外跑一個 cc-mobile。它不需要改 session 鍵，但手機要在兩個網址之間切換，推播訂閱、前景判斷、audit log 也都要變成兩份。收件匣要的正是在同一個畫面看兩邊，所以把兩個 socket 收進同一個程序比較直接。

## 落選方向

- **為機庫另外跑一個 cc-mobile**：理由見上一節。
- **兩邊的 session 鍵都加前綴**：格式一致，但駕駛艙的舊草稿和狀態會成為孤兒，快取的舊 bundle 也會對不上。使用者 2026-10-08 選了只給機庫加。
- **只有機庫不退出，駕駛艙照舊退出**：崩潰循環的成因沒有消失。使用者 2026-10-08 否決。
- **機庫預設啟用**：沒有機庫的機器會一直推播「機庫離線」。
- **機庫恢復時也推播**：會把人叫回一個沒有事要做的 app。
- **把 `CC_MOBILE_PUSH_SCOPE` 設成 `all`**：開關今天就有，但它也會讓駕駛艙每個 pane 都推播，而駕駛艙正是使用者坐在電腦前的地方。

## 風險

- **協定不相容仍然會造成崩潰循環。** 它依然是啟動失敗，而 pm2 沒有重啟延遲。這次不處理，pm2 的設定屬於 `hangar-prod-rollout`。
- **300 秒寬限的代價是晚知道。** 機庫倒了，至少要過 5 分鐘手機才會收到推播。這是使用者選的，換到的是 herdr 短暫重啟或卡頓不會誤報。
- **專案名在機庫可能失去意義。** 推播的專案名取自 cwd 的 basename。如果 `hangar-worktree-isolation` 讓每張卡在自己的 worktree 執行，basename 可能變成 worktree 名稱，而不是專案名。這要在那張卡處理。
- **機庫的推播量可能太大。** 同時執行的上限是 4（`hangar-concurrency-cap`），每個 session 的每個回合都會進合併窗口。結果訊號（`outcome-signal-push`）會改寫機庫推播的內容與時機，這則 ADR 只決定範圍。

## 與既有 ADR 的關係

### ADR-015（herdr 取代 tmux 作為持久化終端層）

延伸。ADR-015 讓 herdr socket 成為唯一的 trunk。這裡 trunk 仍然只有 herdr socket，只是從一條變成兩條，沒有引入其他通道。ADR-015 §2026-08-02 把 session 鍵定為 herdr 的 `pane_id`，這裡只對機庫加上伺服器前綴，駕駛艙的鍵不變。

### ADR-017（推播讀 herdr 的原始狀態，不等權限卡片）

修改它的一處，其餘沿用。

- **修改**：`docs/milestones/push-state-driven.md` 寫明「範圍與對象完全不動」，ADR-017 也只改了推播的時機，範圍一直是 phone-last。現在範圍改成依 socket 而定：機庫一律推播，駕駛艙照舊。
- **延伸**：新增一種推播「機庫離線」。它沿用一種推播一個 tag 的規則，也沿用 §push-foreground-suppress 的前景抑制。它不關於任何 pane，所以照 §push-meaningful-copy 的規則送通用文案。attempt log 的 `kind` 會多一個值。
- **沿用**：`blocked` 立刻送、`done` 的 45 秒窗口、前景抑制，以及專案名文案，原樣套用到機庫的推播。

### ADR-003（permission mode 預設）

已被推翻，不相關。機庫的 agent 用什麼權限設定，由派發時選的 profile 決定，不在這則 ADR 的範圍。

## 結論

cc-mobile 同時看駕駛艙和機庫，機庫的 session 鍵加上 `<name>@` 前綴，駕駛艙的鍵不變。兩邊連不上都不再讓程序退出，只有協定不相容例外。機庫離線時推播一次，駕駛艙離線只在 app 裡顯示。推播範圍改成依 socket 而定：機庫一律推播，駕駛艙維持 `CC_MOBILE_PUSH_SCOPE`。

三個決定都由 vault 的實作卡 `hangar-socket-connection` 實作。決定三需要知道 pane 屬於哪一個 socket，所以和前兩個放在同一張卡。

## 2026-10-08 增修：實作時定下的三處細節

### 機庫 pane 第一次看到的 `done` 不推播

cc-mobile 重啟後，第一次看到某個機庫 pane 的 `done`，只記下「這個 pane 已經看過」，不推播。那個 turn 在 cc-mobile 開始看之前就結束了，推播只會是遲到的舊消息。第一次看到的 `blocked` 仍然推播，因為還有人在等答案。這是使用者 2026-10-08 的裁決，決定三的「機庫內的 session 一律推播」以此為準。

### 離線警報的條件是「不可用」

300 秒離線警報計算的是機庫不可用的時間，不只是連不上。socket 連得上、但對方講的是另一個協定，同樣算進這 300 秒，也同樣只推播一次。決定二的「連不上」請讀成「不可用」。這是使用者 2026-10-08 的裁決。

### 更正分隔字元的理由

決定一說 `/` 不能當分隔字元，是因為鍵會被當成上傳目錄名稱。這個理由不對。上傳檢查 `server/upload-manager.ts:6`（`/^[A-Za-z0-9_-]+$/`）已經擋掉任何含 `:` 的鍵，所以機庫的鍵根本到不了建立目錄那一步。

`/` 仍然不用。鍵日後只要出現在任何檔案路徑或網址裡，`/` 都會被讀成一層目錄。`:` 不能用的理由不變：pane id 裡已經有。

## 2026-10-09 增修：卡片綁定已經實作

決定三說範圍跟著 socket 走，理由之一是「卡片和 session 的綁定還沒有實作（`launch-into-hangar`）」。這個前提已經不成立：`POST /api/launch` 只在機庫開 session，並在送出第一則提示前寫好綁定檔 `~/.claude-mobile/launches/<claudeUuid>.json`（見 CLAUDE.md 的 Launch API 一節）。

決定本身不變，推播範圍仍然跟著 socket 走。這次沒有改成跟著卡片，也沒有重新權衡這個選擇；由 `/api/launch` 開出的機庫 session 都有綁定檔，不是它開的機庫 pane 則沒有，照決定三一樣推播。
