# Module Inventory — ADR-011 PTY 混合架構移植評估

分析基準：ADR-011「搬移既有已驗證模式，非全砍重寫」。  
判斷原則：只有綁死在 SDK `query()` 驅動與 `canUseTool` 的部分才需 DROP/ADAPT；UI、WS protocol、util、session 讀取多半可留。

---

## 檔案分類表

| file | verdict | maps-to-layer | reason |
|------|---------|---------------|--------|
| session-manager.ts | DROP | PTY-driver | 核心依賴 SDK `query()` 驅動對話，換 PTY keystroke 注入後整支需重寫 |
| permission-bridge.ts | ADAPT | hook-endpoint | ADR-002 Promise+阻塞模式同形，但入口從 `canUseTool` 改為 HTTP POST 接收 hook payload；邏輯骨架可留，介面需換 |
| session-history.ts | ADAPT | JSONL-tailer | 目前用 `getSessionMessages()`（free SDK read method），ADR-011 line 56 稱其為「免費唯讀」；可先保留，後續 spike 若確認直接 tail JSONL 更即時可再換 |
| session-listing.ts | KEEP | config-reader | `listSessions()`/`getSessionInfo()` 均為免費 SDK read methods，ADR-011 line 24 明確保留；無計費風險 |
| settings-loader.ts | KEEP | config-reader | ADR-006「讀 ~/.claude」原樣保留，ADR-011 line 55 明確不變 |
| capabilities-cache.ts | KEEP | config-reader | 快取 SDK control methods 結果（免費），ADR-011 line 24 明列 supportedModels/Commands 等均免費 |
| event-buffer.ts | KEEP | WS-protocol | 與計費管道無關，為 WebSocket 重連 replay 機制，可原樣沿用 |
| protocol.ts | KEEP | WS-protocol | Zod WS schema 定義，計費管道切換不影響協定形狀，需新增 hook 相關訊息但可增量擴充 |
| ws.ts | ADAPT | WS-protocol | 大量業務邏輯依賴 session-manager 的 query() 輸出；session-manager 換掉後需對接新的 PTY 事件，其餘 WS 路由（rename、list、history）可留 |
| config.ts | KEEP | config-reader | PermissionMode 型別與 CLI 設定解析，與驅動管道無關 |
| path-utils.ts | KEEP | util | buildUrl/stripBasePath 純工具函式，無管道相依 |
| tool-output-truncator.ts | KEEP | util | 純文字截斷工具，與驅動無關 |
| upload-manager.ts | KEEP | util | 上傳目錄管理，與驅動無關 |
| upload.ts | KEEP | util | 上傳 HTTP endpoint，與驅動無關 |
| index.ts | KEEP | util | Elysia app 初始化與靜態服務，PTY 替換為 session-manager 內部細節，頂層組裝影響有限 |
| ws-service.ts | ADAPT | WS-protocol | 客戶端 WS 服務，依賴 stream_event 型別事件；ADR-011 改為 JSONL tail 事件後，事件格式會變但 WS 連線管理邏輯可留 |
| tool-events.ts | ADAPT | JSONL-tailer | 型別守衛與事件解析目前解析 SDK typed stream events；改 tail JSONL 後事件形狀不同，型別守衛需重寫，但分層概念保留 |
| session-persistence.ts | KEEP | WS-protocol | localStorage 狀態序列化，與後端驅動管道無關 |
| diff-utils.ts | KEEP | util | diff 計算純工具，無管道相依 |
| draft-persistence.ts | KEEP | util | localStorage draft 存取，無管道相依 |
| haptic.ts | KEEP | util | 震動回饋服務，無管道相依 |
| highlighter.ts | KEEP | util | shiki 語法高亮，無管道相依 |
| lifecycle-manager.ts | KEEP | util | PWA 頁面生命週期監聽，無管道相依 |
| notification.ts | KEEP | util | 推播通知服務，無管道相依 |
| permission-options.ts | KEEP | UI | 手機端 permission 選項文字與顏色定義，hook 架構下仍需此邏輯 |
| pins.ts | KEEP | util | 釘選指令的 localStorage 存取，無管道相依 |
| projects.ts | KEEP | util | 專案清單 localStorage 存取，無管道相依 |
| settings.ts | KEEP | util | 客戶端設定 localStorage 存取，無管道相依 |
| sw-registration.ts | KEEP | util | Service Worker 註冊，無管道相依 |
| toast-service.ts | KEEP | util | Toast 通知 UI 服務，無管道相依 |
| tool-registry.ts | KEEP | UI | 工具圖示與標題定義，無管道相依 |
| upload-service.ts | KEEP | util | 客戶端上傳 HTTP 封裝，無管道相依 |
| app-store.ts | KEEP | WS-protocol | Zustand 多 session 狀態，與驅動管道隔離；若事件形狀變更需小幅 ADAPT 但骨架可留 |
| settings-store.ts | KEEP | util | Zustand 設定狀態，無管道相依 |
| ActivityStrip.tsx | KEEP | UI | 活動狀態顯示 UI，無管道相依 |
| AddProjectScreen.tsx | KEEP | UI | 新增專案畫面，無管道相依 |
| AppShell.tsx | KEEP | UI | 頂層佈局殼，無管道相依 |
| AttachmentSheet.tsx | KEEP | UI | 附件選擇 sheet，無管道相依 |
| ChatScreen.tsx | KEEP | UI | 對話主畫面，與計費管道無關；事件格式變更由 ws-service/tool-events 層吸收 |
| CompactDivider.tsx | KEEP | UI | Compact 分隔線 UI 元件，無管道相依 |
| ContextUsageChip.tsx | KEEP | UI | Context 使用量顯示 chip，無管道相依 |
| EnvVarSheet.tsx | KEEP | UI | 環境變數設定 sheet，無管道相依 |
| InputBarA.tsx | KEEP | UI | 輸入列元件，PTY keystroke 注入從 ws-service 層處理，UI 不感知 |
| ModelSheet.tsx | KEEP | UI | 模型選擇 sheet，無管道相依 |
| PermissionModeSheet.tsx | KEEP | UI | Permission mode 設定 sheet，無管道相依 |
| PermissionSheetA.tsx | KEEP | UI | 手機端 permission 批准/拒絕 UI，hook 架構下仍需此元件 |
| PickerSheet.tsx | KEEP | UI | 通用選擇 sheet，無管道相依 |
| ProjectDetailScreen.tsx | KEEP | UI | 專案詳情畫面，無管道相依 |
| ProjectsScreen.tsx | KEEP | UI | 專案清單畫面，無管道相依 |
| QuickActions.tsx | KEEP | UI | 快速動作列，無管道相依 |
| RenameSessionSheet.tsx | KEEP | UI | Session 重命名 sheet，無管道相依 |
| SettingsScreen.tsx | KEEP | UI | 設定畫面，無管道相依 |
| ToolCardA.tsx | KEEP | UI | 工具卡片 UI 元件，無管道相依 |
| AskUserQuestionUI.tsx | KEEP | UI | AskUserQuestion 互動 UI，無管道相依 |
| AttachmentButton.tsx | KEEP | UI | 附件按鈕 UI，無管道相依 |
| AttachmentPreview.tsx | KEEP | UI | 附件預覽 UI，無管道相依 |
| DebugOverlay.tsx | KEEP | UI | Debug 覆蓋層，無管道相依 |
| EnvVarEditor.tsx | KEEP | UI | 環境變數編輯器，無管道相依 |
| FolderPicker.tsx | KEEP | UI | 資料夾選擇器，無管道相依 |
| MarkdownRenderer.tsx | KEEP | UI | Markdown 渲染元件，無管道相依 |
| MermaidBlock.tsx | KEEP | UI | Mermaid 圖表元件，無管道相依 |
| OptionButton.tsx | KEEP | UI | 選項按鈕元件，無管道相依 |
| QuestionStepper.tsx | KEEP | UI | 問題步進器元件，無管道相依 |

---

## 結論

**KEEP / ADAPT / DROP 佔比：**

- KEEP：55 個（約 87%）
- ADAPT：5 個（約 8%）— permission-bridge.ts、session-history.ts、ws.ts、ws-service.ts、tool-events.ts
- DROP：1 個（約 2%）— session-manager.ts（核心 query() 驅動）

**overall_roll: KEEP_PROJECT**

絕大多數程式碼（87%）與計費管道完全無關，可原樣保留。真正需要換掉的只有 `session-manager.ts`（一個檔案），以及五個需要調整介面或事件格式的 ADAPT 檔案。這個比例強烈支持「搬移既有模式」而非另起新專案：UI 層（40+ 個元件）、WS protocol、util、session 讀取全部可留；唯一核心替換是驅動層從 `query()` 改為 PTY keystroke，正如 ADR-011 架構表所示。重寫成本集中在一支檔案加五支介面調整，遠低於從頭建立整個 PWA 框架的成本。
