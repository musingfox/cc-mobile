# ADR-016: 手機的 session 畫面是 transcript 的投影

## Status

Accepted（2026-08-08）

## Context

### 背景

在手機上打開一個 session，聊天區是空的，要等下一輪對話才有東西。這不是缺陷，是 ADR-015 §2026-08-02 決策第 2 點的直接後果：transcript 讀回的游標附著在檔尾，為的是不讓既有對話被當成剛剛說的話重播。

但 §1 的目標是「在手機上繼續終端機的 session」。從終端機接手一個正在跑的 session 時，空白畫面讓那件事失效——使用者不知道它在幹嘛。#26 刻意刪掉的是「瀏覽已死的 session」（listing、resume），不是「一個活著的 pane 自己的 backlog」。

### 已確認事實（查證日期：2026-08-08）

- **穩定身分已經在檔案裡，只是被丟掉**：claude record 帶 `uuid`/`parentUuid`/`timestamp`，omp record 帶 `id`/`parentId`/`timestamp`，兩者都在 `server/transcript/records.ts:96` 的 `return { type, message }` 被丟棄。而 `stream_chunk.chunk` 是 `z.record(z.unknown())`（`server/protocol.ts:150-153`），加欄位不是協定變更，手機上已快取的舊 bundle 不會壞。
- **身分的完備性與唯一性實測**（本機最大的 25 份，2026-08-08）：claude 28588 筆可渲染 record，缺 `uuid` 0 筆；omp 5858 筆，缺 `id` 0 筆、重複 0 筆。claude 有 5 筆 uuid 重複，全部集中在一個檔，型態是**同一筆記錄被追加寫了第二次**——`uuid`/`parentUuid`/`timestamp` 全同，第二份多一個 `slug` 欄位。也就是說重複是「同一筆」而非「兩筆撞號」，以 id 去重正好收掉它；反過來說，**檔案本身就會出現重複，去重不是只為了分頁重疊而存在**。
- **`stream_event` 在 server 端已無任何來源**（#25 刪除 SDK query 路徑之後全樹零命中），但 client 仍保留整套 `stream_event` 分支與 `currentStreamMessageId` 串流泡泡機制（`client/services/ws-service.ts:300`、`898-914`、`client/stores/app-store.ts:202`）。那是一套與 record 身分並行的 client 生成 id 制度。
- **手機現在只看得到半邊對話**：server 已經送 `{type:"user"}` chunk（`records.ts:59`），但 `extractTextFromChunk`（`client/services/ws-service.ts:287`）只認 `assistant` 與 `stream_event`，user record 一路被丟掉。手機上每一顆 user 泡泡都來自本地樂觀回音（`ws-service.ts:1174`）——**終端機那邊打的 prompt，手機從來看不到**。
- **訊息身分現在不可重複取得**：id 全由 client 生成（`ws-service.ts:902`、`916`、`1175`），重讀同一筆 record 必得新 id。`lastOptimisticSend`（`ws-service.ts:374`，消費於 `1079`）只用來撤銷被拒的送出，不是去重機制。
- **體積**：本機 313 份 claude transcript，p50 57KB，最大 11MB / 4671 行。最大那份原樣轉送所有 renderable record 是 3154 筆 / 4.97MB，但真正畫得出來的文字只有 419 則 / 204KB。整份讀取加解析 38ms。
- **位元組不能當分頁單位**：大型 session 裡可渲染 record 只佔 7–13% 行數，往回抓固定位元組可能一筆都撈不到。
- **herdr 沒有 scrollback 可鏡射**：`pane read --source {visible|recent|recent-unwrapped} --lines 5000` 三者皆只回一個螢幕（44 行 / 2.5KB）。
- `client/components/linear/ChatScreen.tsx:45-50` 每次 `messages.length` 變動就無條件捲到底；無虛擬化。
- localStorage 逐 session 持久化跨切換與重載存活（`client/services/session-persistence.ts:39`），其失敗路徑靜默（`:62`）。

## 決策

手機上的 session 畫面從「你在手機上打的對話紀錄」變成**這個 session 的 transcript 的投影**。

1. **身分取自檔案**。每一則從 transcript 讀出的 chunk 帶上該 record 自己的穩定 id（claude `uuid` / omp `id`），client 以它作為訊息 key。同一筆 record 不論從 live sink 或歷史頁進來，id 相同——**重複抓取因此天然冪等**，開啟時首頁歷史與檔尾 live 游標的重疊區自動去重。這是身分必須先做的唯一理由。相同 id 再次抵達時**後者覆蓋前者**（claude 確實會把同一筆記錄重寫一次，見上文實測），不並列。

   同時**刪除 client 端的 `stream_event` 路徑與 `currentStreamMessageId` 串流泡泡機制**：server 早已不發 `stream_event`，留著等於在 record 身分旁邊並存第二套 client 生成的 id 制度，而那正是本決策要收掉的東西。

   實作分歧（#34 落地時記錄）：「後者覆蓋前者」在 `upsertMessage` 裡是**以舊訊息為底的合併**，不是整筆置換——只存在於舊那份的欄位會存活。對促成這條規則的 `slug` 重寫情境無害（record 只會長欄位不會掉欄位），但字面上比本決策寬。

2. **渲染 user record**。終端機那邊打的字從此出現在手機上。這是產品定義的改變，也是歷史能安全重複抓取的前提。

3. **畫面順序是 transcript 的檔案順序，不是到達順序**。sink 在使用者打開該 session 之前就已綁定（`server/ws.ts:353`），live chunk 可能早於首頁歷史抵達，也可能在抓取途中插進來。去重解決重複，不解決次序。record 自帶 `timestamp` 與 parent 鏈，次序可推導。

4. **樂觀回音以「送出事件 × 文字 × 有界時間窗」對帳**。送出當下沒有 transcript id，所以系統裡恰好有一種泡泡不是用檔案身分配對的：本地樂觀回音，由第一筆文字相符、且落在送出後有界時間窗內的 inbound `user` record **取代**（supersede，非並列）。取代即交還身分，之後它就是那筆 record，並移到它在檔案裡的位置。視窗大小與比對寬鬆度是實作參數；**配對錨點本身是決策**，不得改用其他依據。

5. **歷史走一組自己的請求／回應對，由 client 往回拉**。request 帶 sessionId + 頂端游標 + 頁大小；response 帶一批 record（由舊到新）、下一個游標、是否已到檔頭。
   - **回應是自己的信封，不是 `stream_chunk`**：client 必須分得出「往上貼的舊訊息」與「剛剛發生的」。但**信封裡的 record body 與 live 路徑共用同一個 mapper**（`transcriptRecordToChunk`）——不重塑內容，ADR-015 Decision M1 原封不動。
   - **頁的單位是 mapper 回傳非 null 的 record**，不是位元組、不是行；往前掃到湊滿 N 筆或掃到檔頭為止。
   - **頂端游標由 client 持有，server 不發也不記**：live chunk 可能在使用者還沒打開該 session 前就到了，游標歸 client 才不會兩邊打架。Server 不保存任何 per-session 歷史狀態。
   - **預設頁大小 N = 50**。單頁即使原樣轉送也被 N 界住，因此不需要為了體積去動「不重塑」的承諾。

     ~~本機最大 session 共 419 顆泡泡 ≈ 9 頁~~ — **這句算錯了母體**（2026-08-09 更正）。頁的單位是 mapper 非 null 的 record，不是泡泡：那份檔有 **3160 筆** mapper 非 null record，即 **63 頁**，其中只有 410 筆帶得出可見文字（全語料可見比例 16.9%）。N=50 用正確的母體重推仍然成立，但理由換了：一頁 ≈ 6.5 顆可見泡泡 ≈ 一個手機螢幕，也就是「一次手勢換一個螢幕」，而不是「幾頁捲到檔頭」——沒有人會把 3160 筆的 session 捲到頂。代價是**一頁有可能一顆泡泡都不長**（純工具往返），這由 affordance 留著、可以再按一次來吸收。
   - **命名不得沿用 `session_history`**。#26 的 Zod gate 拒的是「瀏覽已死的 session」；這裡拉的是一個活著的 pane 自己的 backlog——沒有 listing、沒有 resume、沒有選 session。名字必須讓 reviewer 一眼看出這個區別（走 `transcript_*` 而非 `session_*` 的字彙）。

6. **持久化留著，不砍**。`readable` 不是全體都有：omp 可能長期有 key 而無檔，未註冊 reader 的 kind 根本沒有讀回路徑，而 `drivable` 仍為 true、composer 仍可用——使用者可以在一個沒有可取歷史的 pane 上對話，丟掉本地紀錄那段對話就補不回來。舊的 localStorage 內容**降級為 local-only**：沒有 transcript id，因此永遠不參與分頁、不參與去重、也不會被取代。

   **丟棄的範圍跟著已取得的歷史走，不是第一頁到就全丟**：只丟棄「不比已取得的最舊 record 更舊」的 local-only 訊息，其餘留在歷史區塊上方，隨著往上捲逐步讓位，直到取到檔頭才清完。第一頁只有 N 筆，一次全丟會讓畫面在歷史抵達的瞬間**縮短**——使用者得往上捲才能拿回本來就在螢幕上的內容。永遠取不到歷史的 session 就永遠留著自己的本地紀錄，因此這條規則不需要判斷 `readable`。

7. **不可讀 session 的歷史 affordance 直接不存在**，不能給一個按下去永遠回傳零筆的「載入更多」。`readable` 是快照值，affordance 跟著最新一次 listing 走，不是開啟時檢查一次就定案（omp 在第一輪寫檔後會翻成可讀，kind 晚偵測到也會，且沒有任何東西會主動推播這個變化）。

8. **往上捲時的捲動錨定是本決策範圍內的必要條件**，不是後續優化：`ChatScreen.tsx:45-50` 現在每次訊息數變動就無條件捲到底，往頂端插入舊訊息會把視野彈走，那樣功能等於不能用。

### 落選方向

- **有界一次性回填、不做分頁**：最小且可逆，但要拿「本機無訊息」當閘門（現行路徑沒有去重），回填會讓 session 看起來正在跑、時間戳變成「現在」，且一次灌完直接撞上體積問題。
- **語意邊界（顯示上一個壓縮點之後的全部）**：界線有意義（等於 agent 自己還記得的範圍），但沒有可調的 N，沒壓縮過的 session 等於「全部」，體積問題原封不動，而且照樣需要穩定身分。
- **不做歷史、只在頂端標示缺口**：完全可逆的下限，但沒有解掉「從終端機接手時不知道它在幹嘛」這個原始痛點。
- **Server 記憶體環形緩衝 + 既有 replay 契約**：不必新增對外契約，client 已經會處理 `lastEventIds` / `replay_complete`，但 server 啟動前的內容永遠不存在——pm2 重啟後、昨天開的 pane，第一次打開仍然空白，而那正是最常見的情境。

## 風險

- ~~**穩定 id 不是全體具備或不唯一**~~ → **已於 2026-08-08 實測排除**（見上文「身分的完備性與唯一性實測」）。殘餘風險只剩「同一筆記錄被重寫」這一種，已由「後者覆蓋前者」吸收。
- **樂觀回音對不上讀回的 user record**（agent 改寫 prompt 文字、加包裝，或終端機回音形態不同）→ 決策 4 的錨點失效。備援方向是**放棄樂觀回音、只從檔案渲染**，用往返延遲換正確性。
- **檔案順序無法從 record 本身可靠推導**（時間戳精度不足且 parent 鏈有斷點）→ 決策 3 要換依據，最壞情況是必須由 server 附上序號，那會把「server 不記狀態」的承諾推向邊界。
- **N=50 一頁仍常常是數 MB**（單筆 record 極大）→ 以筆數計數界不住 payload，就得加每頁位元組上限，或去動「不重塑」的承諾，那會讓這條路貴很多。
- **未查證假設**：「一個 pane 的歷史 = 一個 transcript 檔」。`pane_id` 在 `/clear` 後存活，但 transcript 檔在該邊界是否輪替／重置沒有任何一條事實證實。若會輪替，「捲到頂」的意思是「這個檔的頂」，與使用者預期不同。**實作前必須先探，不得當成已知條件建構。**

## 2026-08-09 修訂（實作落地時查證所得）

實作前的量測推翻或收緊了上面幾條，逐條記在這裡而不是改寫原文，原決策的推理仍然可讀。

- **檔案順序改由 server 蓋位元組位移（`seq`）承載**，決策 3 的「次序可推導」不成立。實測：642 份檔裡有 35 份出現同毫秒 `timestamp`，另有一份的時間戳倒掛 2.2 天；而 7.6% 的可渲染 record，其 `parentUuid` 指向的是 mapper 丟掉的 record，走 parent 鏈等於要 server 保留並送出自己正在抑制的骨架。風險 §70 講的「最壞情況是必須由 server 附上序號」就是實際情況。位元組位移是不用另外算的序號（reader 本來就在累加位元組），也是這批資料唯一支撐得住的全序。**`seq` 只在同一個檔內可比。**
- **同一個 id 再次抵達時，位置取兩者較小的 `seq`，內容取後到的那份。** 決策 1 的「後者覆蓋前者」只講內容；重複的實際型態是「同一筆記錄被寫了第二次」（本機一份檔有 5 筆在 2691 行之後被重新追加），照後到的位置擺會把 7/31 的 record 排到 8/2 之後——正是上面那個倒掛問題。原始位置才是真的。
- **transcript 檔會輪替，而且只有 `/clear` 會**（風險 §72 的未查證假設，已探）。`/compact` 不輪替（28 次全部在檔案中段，`compact_boundary` 沿用該檔自己的 `sessionId`）、`/resume` 與 `--continue` 不輪替（`--fork-session` 才會，且它是明示的 opt-in）。因此新增 **epoch**：每個 transcript 來源的 chunk 與每一頁都帶上該檔身分的短摘要，client 一旦看到 epoch 從一個非 null 值變成**另一個**非 null 值，就丟掉該 session 畫面上的全部訊息並改跟新的。手機因此在、且只在終端機自己清空時清空。
  - **清空的範圍是硬邊界**：epoch 缺席、為 null、為空字串、或 `transcript_unavailable`，一律**不清**。這條是人類在決策閘上的附帶條件（「比照 cli 本來的行為處理，避免搞亂其他指令的行為」）落成的可執行規則——herdr 在 agent 結束時會把 `agent_session` 明示回報成 null（`pane-events.ts:236-245` 視之為值變更），若不擋，一個 agent 退出就會清掉整個對話，而使用者什麼指令都沒下。server 端對應的義務只有一條：**解析不到路徑時不得蓋 epoch**，也就不會送出任何帶 epoch 的 chunk。
  - server 那側的 `resetCursor` 在 null 轉換時**維持原樣**：對 server 而言「現在沒有檔可以 tail」是真的，繼續對一個死掉的檔跑 1 秒 stat 迴圈才是 bug。「不清空」是 client 的規則。
  - 附帶：因為 `/compact` 不改 epoch，壓縮點不會、也不需要成為分頁邊界或畫面上的標記。
- **頂端游標是三段收據 `{epoch, seq, recordId}`，每次請求都對檔案重驗**。決策 §47「游標歸 client、server 不記」維持不變，但游標必須自證：路徑是每次 call 現查的，一個輪替前的位移拿到新檔上會被安靜地讀成別的內容。驗不過（epoch 不同／該位移上的 record 換了 id／超出檔尾）不是錯誤，**降級成回傳當前檔的最新一頁**，並用回應自己的 `epoch` 說明它讀的是哪個檔。順帶擋掉 in-place 改寫（`/rewind`，未探）。
- **每次打開 session 都抓最新一頁**，不是只有第一次。決策 §44 沒說是哪一種；選每次，因為那是唯一能在終端機清空之後把畫面重新對齊的使用者手勢。同一個 epoch 的頁是視覺上的 no-op（鏡射承諾保證），所以重抓不會產生重複。
- **local-only 內容在第一頁歷史抵達時一次丟棄**，取代決策 §53 的「跟著已取得的歷史逐步讓位」。判準是「沒有 `recordId` 且時間早於這次請求送出的時刻」，所以正在送出中的樂觀回音會活下來。§53 顧慮的「畫面在歷史抵達的瞬間縮短」仍然存在，接受它換取一條說得清楚的規則：畫面上要嘛是 transcript，要嘛是還沒有 transcript 的本地紀錄，不會是兩者按時間拼起來的東西——後者需要一個跨 epoch 的順序，而這批資料沒有。錯誤回應（含 `transcript_unavailable`）不丟棄任何東西。
- **session 的 epoch 隨 localStorage 一起持久化**（游標不持久化）。否則每次重載都是「未知 epoch」，與輪替無法區分，還原的訊息會在下一頁抵達時被清光——那會是這條線沒有授權的第二次刪除行為。游標缺席則自癒：下一次開啟本來就會抓最新一頁。
- **重播防護放在 client**：client 記住自己離開過的 epoch，丟掉任何蓋著已退役 epoch 的 chunk。server 的 `eventBuffer` 仍然不裁剪（每 session 500 筆），那是 issue #39 自己的接線，不在這條線裡。因此殘留一個已知缺口：一支連著、閒置、也沒有重開該 session 的手機，會繼續顯示已被清空的對話，直到下一次收到 chunk 或重開該 session。

## 與既有 ADR 的關係

### ADR-015（herdr 取代 tmux 作為持久化終端層）

修訂其 §2026-08-02 決策第 2 點：**live 送達路徑維持檔尾附著，不變**。新增的是「歷史是另一扇門」——有序、成批、貼在畫面上方，不冒充剛剛說的話。原本那句「附著時游標取檔尾，因此不會把既有對話當成新訊息重播」的意圖完整保留：既有對話仍然不會被當成新訊息，它走自己的信封進來。

Decision M1（不重塑內容）不受影響：歷史信封裡的 record body 與 live 路徑共用同一個 mapper。

`readable` 的地位（只揭露、不封鎖）沿用：不可讀的 session 沒有歷史 affordance，但 `drivable` 仍為 true、composer 仍可用。

## 結論

手機不再是「你在手機上打的東西的紀錄」，而是這個 session 的鏡子。這讓終端機打的字第一次出現在手機上，也讓歷史可以被安全地重複抓取——後者是前者的直接結果，不是另外加上去的機制。

決策過程與各方向的權衡見 [`spiral-016/`](spiral-016/)：[方法層定案](spiral-016/L1-plan.md)、[當初的四條路](spiral-016/L1-a1-directions.md)。
