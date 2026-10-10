---
status: done
delivered: 8c47ed9
depends: []
---

# 資料夾瀏覽器要能走到每個允許根目錄

## 這個里程碑交付什麼

手機的資料夾瀏覽器（Add Project 裡的「Browse…」）在設定了多個允許根目錄時，每一個根目錄都要能用點選抵達，不必手打路徑；瀏覽時也不會再因為往根目錄之上走而撞到 `path_not_allowed`。

以下三件事不在範圍內，保持原狀：

- Projects 清單本身，也就是每台手機各自保存、最多 10 筆的那份清單。
- 伺服器的路徑檢查規則。
- 一個 session 只有一個 cwd。

## 起點：今天已經有的與缺的

- **只需要改手機端。** 伺服器已經把 `allowedRoots` 與 `homeDirectory` 隨 `server_config` 送到手機（`server/ws.ts:381-382`）。伺服器也已接受任一根目錄內的路徑：`server/config.ts:127-138` 以逗號切開 `CC_MOBILE_ALLOWED_ROOTS`，`server/path-utils.ts:53-75` 只要路徑在任一根目錄內就放行。所以這件事不需要新的訊息類型或新欄位。
- **缺口一：起點固定是第一個根目錄。** `client/components/FolderPicker.tsx:29-37` 取 `allowedRoots[0]`，沒設根目錄時取家目錄。第二個以後的根目錄今天只能手打路徑才到得了。
- **缺口二：往上走沒有邊界。** 伺服器對 `/` 以外的每個目錄都回 `parent: dirname(path)`（`server/directory-listing.ts:96`），手機據此顯示 Go Up（`FolderPicker.tsx:110-119`）。在根目錄上按下 Go Up，請求會被 `listDirectories` 以 `path_not_allowed` 拒絕（`server/directory-listing.ts:54-58`）。麵包屑（`FolderPicker.tsx:100`）也可能指向根目錄的上層，需要和 Go Up 一起處理。
- **沒設根目錄時，行為必須維持原樣。** 這時瀏覽器從家目錄開始，可以一路往上走到 `/`。2026-10-10 檢查時，prod 沒有設 `CC_MOBILE_ALLOWED_ROOTS`：pm2 `cc-mobile-prod` 的環境與 `ecosystem.config.cjs` 都沒有這個變數。
- **只有一個根目錄時，不多出任何步驟。** 這是本計畫取的預設，日後要改也容易：根目錄清單只在根目錄有兩個以上時才出現；只有一個時，瀏覽器直接從那個根目錄開始，和今天一樣。
- **`getInitialBrowsePath` 的去留由實作決定。** 它位於 `server/directory-listing.ts:108-113`，目前只有測試呼叫，手機端另外重寫了同樣的邏輯。這份計畫不決定它要跟著改還是刪掉。

## 刻意留給實作規劃的事

- **起點清單從哪來。** 一種是沿用 `CC_MOBILE_ALLOWED_ROOTS`，代價是這份便利清單同時成為安全限制。另一種是另開一份只管瀏覽、不限制路徑的清單，這會多出一個新的設定格式，而且是改不回去的單向門，必須由人選擇。如果規劃時沒有新的理由，就沿用既有的變數，因為它不需要新的格式。
- **根目錄清單的樣子與位置。** 它可以是瀏覽器開啟時的第一個畫面，也可以是麵包屑最左端的切換器。
- **在根目錄上往上走時怎麼處理。** 可以隱藏 Go Up，可以改成回到根目錄清單，也可以由伺服器在根目錄處回 `parent: null`。同時要決定由手機還是伺服器判斷邊界。

## 驗收

- 設定兩個以上的允許根目錄時，每一個根目錄都能在瀏覽器裡只靠點選抵達。
- 從任何根目錄往上走，畫面上都不會出現 `path_not_allowed` 錯誤。
- 只設一個根目錄時，瀏覽器的開啟位置與步驟和改動前相同。
- 沒設根目錄時，瀏覽器的開啟位置與步驟和改動前相同。
- 伺服器的路徑檢查與 WebSocket 協定沒有改變。

## 什麼會推翻這個決定

- 如果最後不打算在 prod 設多個允許根目錄，這件事對使用者就沒有可見的效果，正確答案會變成「已經能做，不必再做」。
- 如果真正的痛點是 project 從清單裡消失，原因是 10 筆上限，加上每開一個 session 清單就重排並截斷（`client/services/projects.ts:2,20-31`）。改瀏覽器解決不了這個問題。
- 以下是落選的方向：
  - **清單不再自動擠掉資料夾**：沒有被選，10 筆上限維持不變。
  - **清單由伺服器提供、各裝置共用**：沒有被選，因為這會把手機私有的便利清單變成公開契約。
  - **一個 project 跨多個資料夾**：沒有被選。真的需要時，可以在 `~/.claude-mobile/agent-profiles.json` 寫一個帶 `--add-dir` 的 operator profile，不必改程式。手機自選額外資料夾則違反「手機只送 profile id、不指定 argv」的裁決（CLAUDE.md〈Security Constraints〉）。

## Suggested skills

- `cf:cf`：實作入口。以這份文件為種子，自己完成研究、規劃與把關。
- `run`：設定兩個根目錄啟動 dev server，在真的 app 裡點過每個根目錄，確認畫面上沒有 `path_not_allowed`。
