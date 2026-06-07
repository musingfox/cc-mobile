# ADR-010: 應對 Agent SDK 計費規則變更（2026-06-15）

## Status

Proposed

## Context

### 已確認事實

2026-06-15 起，訂閱方案（Pro / Max5x / Max20x）的 Agent SDK 呼叫（含 `claude -p`）改由獨立的月度 Agent SDK credit 計量，與互動式 Claude.ai 使用額度完全分離。

方案額度一覽：Pro $20/月、Max5x $100/月、Max20x $200/月，各方案均配有獨立 Agent SDK credit，不共用互動式使用額度。

用盡 credit 後，若未另外開啟 usage credits 則硬止（hard stop）。Credits 屬個人帳號，**不可共享**。

來源（查證日期：2026-06-07，來源已查證可訪問且內容相符）：
- https://code.claude.com/docs/en/agent-sdk/overview
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan

查證內容摘要：support.claude.com 現行頁面明載 monthly Agent SDK credit / starting June 15 2026 / Pro $20、Max5x $100、Max20x $200 / 用盡且未啟用 usage credits 則 requests stop。所有事實與 ADR 記錄相符。

### 未確認事項（needs confirmation / 未確認）

- 2026-06-15 後，透過 OAuth 訂閱登入路徑呼叫 SDK 是否仍可正常功能性運作（文件僅描述計量方式改變，未明確排除或確認功能可用性）。

### cc-mobile 曝險結論

**是（yes）**，cc-mobile 受此變更直接影響。

- `CLAUDE.md:16` 明示「No additional API keys needed — the SDK wraps the local `claude` CLI binary」。此假設成立的前提是 SDK 呼叫與互動式用量共享同一帳號額度，或至少不需要額外設定。2026-06-15 起，訂閱 credit 獨立計量，一旦 Agent SDK credit 用盡，cc-mobile 所有工作階段將硬止。
- `ADR-007` 確立 cc-mobile 以 V1 `query()`（即 Agent SDK）為唯一 Claude 呼叫介面。沒有任何 fallback 路徑。

## 應對方向

| 機制 (Mechanism) | Credit 影響 | 工程量 (Effort) | 可逆性 (Reversibility) |
|---|---|---|---|
| 沿用訂閱 credit，監控用量（觀察模式） | 消耗個人 Agent SDK credit，用盡則硬止 | 極低（加 credit 警示 UI） | two-way door |
| 開啟 usage credits 作為 overflow（帳號設定） | credit 用盡後自動以 usage credits 計費，不硬止 | 零（帳號設定，無需改碼） | two-way door |
| 引入 `ANTHROPIC_API_KEY`，改走 API key 計費 | 不消耗訂閱 credit，按 token 計費 | 低（env var + SessionManager 調整） | one-way door |
| 多使用者各自帶 key（per-user API key） | 各用戶自擔 API key token 費用 | 中（WS 協議增加 key 傳遞、server 隔離） | one-way door |
| 拋棄 SDK/CLI 層，改純直接 API（HTTP Anthropic API） | 按 token 計費，無訂閱 credit 消耗 | 高（失去 ADR-007 的 plugin 載入能力）（假設：純 API 路徑確實無法保留 plugin，待驗證） | one-way door |

### 各方向說明

#### two-way door 方向

**沿用訂閱 credit + 監控用量**

不改動架構，僅在前端加入 credit 用量警示或倒計時提示。適合個人單機使用、用量可預期的場景。若 credit 用盡可立即關閉以恢復互動式用量，轉向其他方案均可。工程量極低，決策完全可逆。

**開啟 usage credits 作為 overflow**

在 Claude.ai 帳號設定（Settings → Billing）開啟 usage credits toggle，讓 Agent SDK credit 用盡後自動以 usage credits（按量計費）接續，不產生硬止。Pro、Max5x、Max20x 方案是否都有此 toggle，目前**未確認**（文件未逐方案列舉開關可用性）。對 cc-mobile 來說零代碼改動，屬帳號層級設定，可隨時關閉，是訂閱用戶最低阻力的 bridge 方案。適合用量偶發性超標但不需架構改動的場景。

---

#### one-way door 方向（需人工決策）

以下三個方向一旦採用，均會翻轉 cc-mobile 的核心定位或對外契約，難以低成本回退：

---

**方向 A：引入 `ANTHROPIC_API_KEY`**

在伺服器端讀取 `ANTHROPIC_API_KEY` 環境變數，傳入 SDK 讓其以 API key 計費而非訂閱 credit。

- 翻轉 `CLAUDE.md:16` 「No additional API keys needed」定位，使用者需申請並管理 API key。
- ADR-007 的 V1 `query()` + plugin 載入能力**是否得以保留**：**待驗證假設（needs spike）**。V1 `query()` 透過包裝本地 `claude` CLI binary 運作（CLAUDE.md:16、ADR-007），API key 路徑下 CLI binary 是否仍被呼叫並載入 plugin，目前無文件依據，不得斷言為已知。
- **封鎖語言**：此方向須先執行 plugin spike 才能定案；spike 通過前不可拍板。表中「低工程量」評估以 spike 通過為前提，若 spike 失敗則此評估失效。若 plugin 在 API key 路徑下失效，方向 A 即塌縮、等同純 API（方向 C），兩者實為同一條路。
- 開啟的門：個人或私有部署場景下可完全控制費用；往後多租戶擴展亦以此為基礎。
- 關閉的門：「零設定啟動」的易用性承諾消失；文件與 onboarding 需隨之更新。

**需人工決策**：是否接受放棄「不需 key」定位，以換取費用可控性。

---

**方向 B：多使用者各自帶 key（per-user API key）**

WS 連線建立時由前端傳入 per-user API key，server 以此 key 發起 SDK 呼叫。

- 翻轉 `CLAUDE.md:16` 定位（同方向 A），且進一步要求**每位使用者**各自持有 API key。
- 現行 `CC_MOBILE_ALLOWED_ROOTS` 安全模型假設單一擁有者；多 key 引入使用者隔離複雜度。
- **多人部署適用性**：若單台 cc-mobile 服務多人，因訂閱 credit 屬個人帳號、**不可共享**，訂閱 credit 路徑在多人部署下不可行；per-user key 是此場景下的可行替代路徑。
- 開啟的門：費用由各用戶自擔，部署者不需負擔 API 費用。
- 關閉的門：WS 協議增加 key 傳遞欄位（對外契約），往後移除需協調所有客戶端。

**需人工決策**：是否要支援多使用者場景、是否願意承擔 key 傳遞的安全設計複雜度。

---

**方向 C：拋棄 SDK/CLI 層，改純 HTTP Anthropic API**

移除 `@anthropic-ai/claude-agent-sdk` 依賴，直接呼叫 Anthropic REST API。

- ADR-007 明確記錄 V1 SDK 是為了保留 plugin 載入（16 個 plugin、52 個 slash command、26 個 skill）；純 API 路徑**無法載入 plugin**，等同放棄 cc-mobile 的 full Claude Code parity 目標。（待驗證：未來 Anthropic REST API 是否提供對等 plugin 能力尚無文件依據）
- 開啟的門：完全控制請求格式、計費透明、無 SDK 版本鎖定。
- 關閉的門：plugin / skill / slash command 支援永久失去，除非 Anthropic 於 REST API 層提供對等能力（待驗證：目前無此路線圖文件）。

**需人工決策**：是否接受放棄 plugin 能力換取架構簡化與費用控制。
