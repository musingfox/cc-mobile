> 人類的決定：夠了，就用這個目標

# L1 — 手機打開 session 時看到多少歷史：方法層定案

Layer: L1 (approach). Direction picked by the human, verbatim:
**「完整版：穩定訊息身分 + 歷史協定 + 向上捲動載入」**
Diverge round: `.spiral/L1-a1-directions.md`.

---

## 1. What this layer settles

手機上的 session 畫面從「你在手機上打的對話紀錄」變成「**這個 session 的 transcript 的投影**」：
訊息身分由 transcript record 決定、user record 一併渲染、歷史由 client 主動往回拉，
一次一頁、以「畫得出來的 record」計數，往上捲就再要一頁。

Live 送達路徑（ADR-015 M3，游標附著在檔尾）**不動**；歷史走一扇自己的門。
Server 不保存任何 per-session 歷史狀態。

---

## 2. What is now concrete enough to build on

### 2.1 Mirror commitment（身分）

- 每一則從 transcript 讀出來的 chunk 都帶上**該 record 自己的穩定 id**（claude `uuid` / omp `id`，
  現在在 `server/transcript/records.ts:96` 被丟掉）。Client 以它作為訊息 key。
- `stream_chunk.chunk` 是 `z.record(z.unknown())`（`server/protocol.ts:150-153`），加欄位不是協定變更，
  手機上已快取的舊 bundle 不會壞。
- 同一筆 record，不論從 live sink 還是從歷史頁進來，**id 相同** → 重複抓取天然冪等，
  開啟時「首頁歷史」與「檔尾 live 游標」的重疊區自動去重。這是身分必須先做的唯一理由。
- Client 開始渲染 `user` record（`client/services/ws-service.ts:287` 目前丟棄）。
  終端機那邊打的字從此出現在手機上 — 這是產品定義的改變，也是歷史能安全重複抓取的前提。

### 2.2 排序不變式

> **畫面順序是 transcript 的檔案順序，不是到達順序。**

Sink 在使用者打開該 session 之前就已綁定（`server/ws.ts:353`），live chunk 可能早於首頁歷史抵達，
也可能在抓取途中插進來。去重解決重複，不解決次序 — 沒有這條不變式，下一層會寫成
「歷史往前貼、live 往後貼」，交錯的情況就錯了。
Record 自己帶 `timestamp` 與 `parentUuid` / `parentId`，次序是可推導的。

這條同時決定了 §2.3 沒講完的一件事：樂觀回音被取代時，泡泡**移到它在檔案裡的位置**，
不留在送出時的位置。

### 2.3 樂觀回音的對帳錨點（唯一不靠 id 配對的泡泡）

送出當下沒有 transcript id，所以系統裡恰好有一種泡泡不是用檔案身分配對的：

> **本地樂觀回音以「這次送出」為鍵，由第一筆文字相符、且落在送出後有界時間窗內的
> inbound `user` record 取代（supersede，非並列）。取代即交還身分：之後它就是那筆 record。**

視窗大小、文字比對的寬鬆度（trim / 正規化程度）留給下一層；**配對依據是「送出事件 × 文字 × 有界時間窗」**
這件事在這一層定死，下一層不得改用其他錨點。
`lastOptimisticSend`（`ws-service.ts:374`）是撤銷被拒送出用的，不是去重，不沿用。

### 2.4 歷史協定（拉取）

- **一組請求／回應對**，request 帶 sessionId + 頂端游標 + 頁大小，response 帶
  「一批 record（由舊到新）＋下一個游標＋是否已到檔頭」。
- **回應是自己的信封，不是 `stream_chunk`**：client 必須分得出「這是要往上貼的舊訊息」和
  「這是剛剛發生的」。但**信封裡的 record body 與 live 路徑完全同一個 mapper**
  （`transcriptRecordToChunk`）— 不重塑內容，ADR-015 Decision M1 原封不動。
- **頁的單位是「套用 `SUPPRESSING_FLAGS` 之後、mapper 回傳非 null 的 record」**，不是位元組、不是行。
  大型 session 裡可渲染 record 只佔 7–13% 行數，往回抓固定位元組可能一顆泡泡都沒有。
  往前掃到湊滿 N 筆或掃到檔頭為止。
- **頂端游標由 client 推導，server 不發也不記**：游標就是「client 目前手上最舊的那筆 record 的位置」。
  Live chunk 可能在使用者還沒打開該 session 前就到了 — 游標歸 client 才不會兩邊打架。
- **預設頁大小 N = 50**（可逆，下一層可調）。本機最大 session 共 419 顆泡泡 ≈ 9 頁；
  單頁即使照現行管線原樣轉送也被 N 界住，不必為體積去動「不重塑」的承諾。
- **命名不得沿用 `session_history`**。#26 用 Zod gate 明確拒絕 `session_history` / `resume_session`，
  拒的是「瀏覽已死的 session」；這裡拉的是**一個活著的 pane 自己的 backlog**，
  沒有 listing、沒有 resume、沒有選 session。新名字必須讓 reviewer 一眼看出這個區別
  （預設走 `transcript_*` 而非 `session_*` 的字彙；確切名稱下一層定）。

### 2.5 UI 邊界

- 往上捲載入時的**捲動錨定屬於本層範圍**：`client/components/linear/ChatScreen.tsx:45-50`
  現在每次 `messages.length` 變動就無條件捲到底，往頂端插入舊訊息會把視野彈走 — 那樣功能等於不能用。
  機制留給下一層，「必須解決」在這一層定案。
- 打開 session 時抓最新的一頁，畫面不再是空白；到檔頭時「載入更多」affordance 消失。

### 2.6 持久化（localStorage）

- **持久化留著，不砍。** `readable` 不是全體都有：omp 有 transcript key 卻可能長期沒有檔案，
  未註冊 reader 的 kind 根本沒有讀回路徑；而 `drivable` 仍為 true、composer 仍可用 —
  使用者可以在一個沒有可取歷史的 pane 上對話。把本地紀錄丟掉，那段對話就沒有東西能補回來。
- **舊的 localStorage 內容不作廢，降級為 local-only**：它們沒有 transcript id，
  因此永遠不參與分頁、不參與去重、也不會被取代 — 沿用 §2.3 的 provisional 概念，不是新規則。
- **它們在該 session 第一次成功取得歷史回應時整批丟棄**，因為那一刻起同一段對話由檔案供應，
  留著就是重覆。這條規則自己會計時，**不需要判斷 `readable`**：
  永遠拿不到歷史的 session 就永遠留著自己的本地紀錄，拿得到的就換成檔案的真相
  （更舊的往上捲就回來了 — 那正是本層的重點）。
- 持久化的失敗路徑是靜默的（`session-persistence.ts:62`，超過約 5MB 就不再持久化且無徵兆）— 已知，本層不處理。

### 2.7 不可讀 session 的 affordance

- 不可讀的 session 顯示自己的本地紀錄，**歷史 affordance 直接不存在** —
  不能給一個按下去永遠回傳零筆的「載入更多」。
- **`readable` 是快照值，affordance 跟著最新一次 listing 走，不是開啟時檢查一次就定案**：
  omp 在第一輪寫檔後會從不可讀翻成可讀，kind 晚一點才被偵測到也會，
  而且沒有任何東西會主動推播這個變化（CLAUDE.md）。因此 affordance 必須能在不重開 session 的情況下出現。

### 2.8 ADR 義務

本層產生一項**必須落在下一層**的紀錄義務：修訂 ADR-015 Decision M3 —
「live sink 維持檔尾附著」不變，新增「歷史是另一扇門：有序、成批、貼在畫面上方，不冒充剛剛說的話」。

### 2.9 粗粒度里程碑順序（只給順序與理由，不再細分）

1. **身分**：chunk 帶 record id、渲染 user record、樂觀回音對帳、檔案順序排序。
   — 可獨立上線且自己就有價值：修掉「終端機打的 prompt 手機看不到」這個現存的洞。
2. **歷史拉取**：request/response 對、往回計數掃描、client 端頂端游標。
   — 沒有 1 的身分就無法冪等，順序不可交換。
3. **向上捲動載入**：捲動錨定 + 到頂邊界 + 不可讀 session 的 affordance 缺席。

---

## 3. Deliberately left to the next layer

- **確切的 wire 名稱、欄位名、Zod schema 形狀。** 現在定只是替下一層挑字，且會與 §2.4 的命名約束重複。
- **游標的編碼**（byte offset？record id？兩者？）— 取決於往回掃描的實作機制，機制未定前編碼是空想。
- **往回掃描的機制**（反向讀窗如何成長、如何避免每頁重讀整檔）。38ms 讀完整份 11MB 說明「先做對再談快」。
- **檔案順序的實作依據**（`timestamp` 排序 vs `parentUuid` 鏈）— 不變式已定，依據要看真實資料的時間戳精度才選。
- **N 是否可由 client 指定、以及 N 的調校** — 需要真機捲動手感才知道，50 是可逆預設。
- **文字比對的正規化程度與時間窗大小**（§2.3 的錨點已定，參數未定）— 需要看真實的 user record 長相。
- **虛擬化 / 渲染效能** — 本機最大 419 顆泡泡，現在做是投機抽象；量測變了再說。
- **可讀 session 是否還需要持久化**（歷史可拉之後，localStorage 可能只剩不可讀 session 需要）—
  取決於開啟時首頁的實測延遲，量測前是猜測。
- **compaction 邊界是否在歷史流裡標示出來**（`compact_boundary` / `compaction` 記錄存在，
  上一個壓縮點 = agent 自己還記得的範圍）— 這是被否掉的那條路的殘影，先不引入第二種語意。
- **claude 與 omp 除 id 欄位名以外的差異**是否還有第二處分歧。

### 未查證的假設（下一層必須先探再設計）

> **「一個 pane 的歷史 = 一個 transcript 檔」。** `pane_id` 在 `/clear` 後存活，
> 但 transcript 檔在該邊界是否輪替／重置，現有事實裡沒有任何一條證實。
> 若會輪替，「捲到頂」的意思是「這個檔的頂」，與使用者的預期不同。
> 標為未查證假設，不得在下一層被當成已知條件直接建構。

---

## 4. What would overturn this

- **transcript record 的穩定 id 不是全體具備或不唯一**（例如某類 omp renderable record 沒有 `id`）→
  冪等前提消失，整條路的地基沒了，退回「有界回填 + 本地閘門」。
- **樂觀回音對不上讀回的 user record**（claude/omp 改寫 prompt 文字、加包裝、或終端機回音形態不同）→
  §2.3 的錨點失效。這同時是備援方向：**放棄樂觀回音，只從檔案渲染**，用往返延遲換正確性。
- **檔案順序無法從 record 本身可靠推導**（時間戳精度不足且 parent 鏈有斷點）→ §2.2 的不變式要換依據，
  最壞情況是必須由 server 附上序號，那會把「server 不記狀態」的承諾推向邊界。
- **N=50 一頁仍常常是數 MB**（單筆 record 極大）→ 以筆數計數並不能界住 payload，
  就得加每頁位元組上限，或去動 ADR-015「不重塑」的承諾 — 那會讓這條路變貴很多。
- **打開 session 抓首頁的延遲被感覺得到**（整份 11MB 解析 38ms，因此不預期發生；若發生，代表反向掃描機制選錯）。
- **transcript 檔在 `/clear` 輪替**（§3 的未查證假設成立）→ 「捲到頂」的語意需要重講，
  可能被迫引入被否掉的語意邊界那條路。

### 落選方向（各一行）

- **有界回填、不做分頁**：最小、可逆，但要拿「本機無訊息」當閘門（現行路徑沒有去重），
  且回填會讓 session 看起來正在跑、時間戳變成「現在」，並直接撞上體積問題。
- **語意邊界（上一個壓縮點）**：界線有意義，但沒有可調的 N；沒壓縮過的 session 等於「全部」，
  體積問題原封不動，而且照樣需要穩定身分。
- **不做歷史、只標示缺口**：完全可逆、最誠實的下限，但沒有解掉「從終端機接手時不知道它在幹嘛」這個原始痛點。
- **Server 記憶體環形緩衝 + 既有 replay 機制**：不必新增對外契約，但 server 啟動前的內容永遠不存在 —
  pm2 重啟後、昨天開的 pane，第一次打開仍然空白，而那正是最常見的情境。
