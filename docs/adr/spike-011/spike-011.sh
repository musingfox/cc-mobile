#!/usr/bin/env bash
# spike-011.sh — 人類手動執行的 ADR-011 spike 驗證腳本
#
# 用途：逐項引導你完成 ADR-011 lines 74-78 的五個假設驗證。
# 約束：本腳本不 spawn claude、不呼叫任何計費 API。
#       它只輸出執行指令、觀察要點、PASS/FAIL 判準，
#       以及要求你把結果填回 docs/adr/spike-011/spike-011-results.template.json 的哪一筆。
#
# 執行環境要求：
#   - claude CLI 已安裝並可執行（`which claude`）
#   - bun 已安裝（用於讀取/寫入 JSON 結果）
#   - REPO_ROOT 設定正確（預設自動偵測）
#
# 用法：
#   bash docs/adr/spike-011/spike-011.sh
#
# 執行後按照每個步驟指示進行，完成後把觀察結果填入
# docs/adr/spike-011/spike-011-results.template.json 對應的條目。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SPIKE_DIR="$REPO_ROOT/docs/adr/spike-011"
RESULTS_JSON="$SPIKE_DIR/spike-011-results.template.json"
HOOK_JSON="$SPIKE_DIR/spike-011-hook.json"

# ─── 顏色輸出 ────────────────────────────────────────────────────────────────
BOLD="\033[1m"
CYAN="\033[36m"
YELLOW="\033[33m"
GREEN="\033[32m"
RESET="\033[0m"

header()  { echo; echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════${RESET}"; echo -e "${BOLD}${CYAN}  $1${RESET}"; echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════${RESET}"; }
step()    { echo -e "${BOLD}${YELLOW}>> $1${RESET}"; }
note()    { echo "   $1"; }
observe() { echo -e "   ${GREEN}觀察：${RESET} $1"; }
passfail(){ echo -e "   ${GREEN}判準：${RESET} $1"; }
writeto() { echo -e "   ${BOLD}填寫：${RESET} 把結果填進 $RESULTS_JSON 的 item_id=\"$1\" 條目"; }

# ─── 前置確認 ─────────────────────────────────────────────────────────────────
echo
echo "=== ADR-011 Spike 驗證腳本 ==="
echo "REPO_ROOT: $REPO_ROOT"
echo "結果檔案: $RESULTS_JSON"
echo

if ! command -v claude &>/dev/null; then
  echo "[ERROR] 找不到 claude 指令，請確認已安裝 Claude CLI。"
  exit 1
fi

echo "請執行以下指令查看 claude 版本，並將輸出填入每個結果條目的 claude_version 欄位："
echo "  claude --version"
echo

# ─── A1: session-id 與 JSONL 檔名綁定 ──────────────────────────────────────
header "A1 — session-id 是否綁定持久化 JSONL 檔名（驗 issue #44607）"

step "準備一個測試 UUID"
note "執行以下指令產生 UUID（或自行準備）："
note ""
note "  export TEST_UUID=\$(uuidgen | tr '[:upper:]' '[:lower:]')"
note "  echo \$TEST_UUID"
note ""

step "啟動互動式 claude 並指定 session-id"
note "執行（在 /tmp 之類的臨時目錄執行以避免污染專案）："
note ""
note "  mkdir -p /tmp/spike-011-a1"
note "  cd /tmp/spike-011-a1"
note "  claude --session-id \$TEST_UUID"
note ""
note "進入互動 TUI 後，隨便輸入一句話（例如「hello」），等回應，然後輸入 /exit 退出。"
note ""

step "確認 JSONL 是否生成"
note "執行以下指令搜尋 JSONL 檔案："
note ""
note "  ENCODED_CWD=\$(python3 -c \"import urllib.parse,os; print(urllib.parse.quote('/tmp/spike-011-a1', safe=''))\")"
note "  ls ~/.claude/projects/\$ENCODED_CWD/ 2>/dev/null || echo '目錄不存在'"
note "  # 也可以直接搜尋："
note "  find ~/.claude/projects -name \"\${TEST_UUID}.jsonl\" 2>/dev/null"
note ""

observe "~/.claude/projects/<encoded-cwd>/\$TEST_UUID.jsonl 是否存在？"
observe "若不存在，JSONL 檔名是否與 UUID 有任何關係？（記錄實際的檔名）"
observe "若 issue #44607 尚未修復，JSONL 檔名可能是隨機 ID，與 --session-id 無關。"

passfail "PASS = JSONL 檔名恰好是 \$TEST_UUID.jsonl"
passfail "FAIL = JSONL 不存在、或檔名與 UUID 無關（記錄實際檔名）"

writeto "A1"
echo

# ─── A2: PreToolUse hook 觸發與 permissionDecision ─────────────────────────
header "A2 — PreToolUse hook 觸發、payload 內容、permissionDecision:deny 效果"

step "安裝 hook script"
note "先建立 hook script（此腳本會記錄 payload 並回傳 deny）："
note ""
note "  cat > /tmp/spike-011-hook.sh << 'HOOKEOF'"
note "  #!/usr/bin/env bash"
note "  # PreToolUse hook script — 記錄 payload，永遠回傳 deny"
note "  LOG=/tmp/spike-011-hook-payload.json"
note "  cat > \"\$LOG\"  # 讀取 stdin 並存檔"
note "  # 輸出 permissionDecision: deny 讓 claude 拒絕此工具呼叫"
note "  echo '{\"hookSpecificOutput\":{\"permissionDecision\":\"deny\"}}'"
note "  HOOKEOF"
note "  chmod +x /tmp/spike-011-hook.sh"
note ""
note "接著把 hook 設定片段（參考 $HOOK_JSON）加進 ~/.claude/settings.json 的 hooks 區段："
note ""
note "  # 備份原有設定"
note "  cp ~/.claude/settings.json ~/.claude/settings.json.bak.spike011"
note ""
note "  # 將以下內容加入 settings.json 的 hooks 陣列（或新增 hooks 鍵）："
note "  # {"
note "  #   \"matcher\": \".*\","
note "  #   \"hooks\": ["
note "  #     {"
note "  #       \"type\": \"command\","
note "  #       \"command\": \"/tmp/spike-011-hook.sh\""
note "  #     }"
note "  #   ]"
note "  # }"
note ""

step "觸發工具呼叫並觀察 hook"
note "啟動互動 claude，要求它執行一個讀取/寫入操作："
note ""
note "  mkdir -p /tmp/spike-011-a2 && cd /tmp/spike-011-a2"
note "  claude"
note ""
note "  在 TUI 中輸入：please read the file /tmp/spike-011-a2"
note "  （或任何會觸發 Read/Bash 工具的請求）"
note ""
note "退出 TUI 後，確認 hook 是否被觸發並查看 payload："
note ""
note "  cat /tmp/spike-011-hook-payload.json | bun -e \"process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))\""
note "  # 或直接："
note "  cat /tmp/spike-011-hook-payload.json"
note ""

observe "payload 是否包含欄位：session_id、transcript_path、tool_name、tool_input？"
observe "claude 是否因 permissionDecision:deny 而未執行該工具？（TUI 中應顯示拒絕訊息）"
observe "若 hook 完全未被觸發，log 檔案不存在。"

passfail "PASS = hook 被觸發、payload 含以上四個欄位、工具確實被拒絕"
passfail "FAIL = hook 未觸發、payload 缺欄位、或 deny 未生效（工具照常執行）"

writeto "A2"
echo

# ─── A3: hook 阻塞時間與 timeout 上限 ───────────────────────────────────────
header "A3 — hook 阻塞等待時間與 claude 行為（量測可用上限）"

step "建立阻塞版 hook script"
note "建立一個 sleep N 秒再回傳 allow 的 hook（先用短時間測試）："
note ""
note "  cat > /tmp/spike-011-hook-block.sh << 'HOOKEOF'"
note "  #!/usr/bin/env bash"
note "  # 阻塞 hook — 讀取 stdin，sleep DELAY 秒，再回傳 allow"
note "  DELAY=\${SPIKE_DELAY:-5}  # 預設 5 秒，可用環境變數覆蓋"
note "  cat > /tmp/spike-011-hook-block-payload.json"
note "  sleep \"\$DELAY\""
note "  echo '{\"hookSpecificOutput\":{\"permissionDecision\":\"allow\"}}'"
note "  HOOKEOF"
note "  chmod +x /tmp/spike-011-hook-block.sh"
note ""
note "修改 ~/.claude/settings.json 的 hook command 為 /tmp/spike-011-hook-block.sh"
note ""

step "測試阻塞行為"
note "分三輪測試（每輪改 DELAY 值）："
note ""
note "  輪 1：DELAY=5   — claude 是否等待 5 秒後繼續？"
note "  輪 2：DELAY=30  — 30 秒等待是否正常？"
note "  輪 3：DELAY=120 — 120 秒等待是否正常？（接近架構要求的阻塞上限）"
note ""
note "在 TUI 中輸入需要工具的請求，觀察 claude 是否在 DELAY 秒後才繼續。"
note ""
note "若想測試 timeout 行為，可將 DELAY 設非常大（如 700），"
note "看 claude 在文件所述的 600s 預設 timeout 後如何反應。"
note ""

observe "claude 是否在 hook 返回前一直等待（不自行繼續）？"
observe "決策生效了嗎？（allow 後工具正常執行、deny 後拒絕）"
observe "可承受的阻塞上限是多少秒（找出 claude 超時退出 / 錯誤的門檻）？"

passfail "PASS = claude 等待 hook、決策生效、且可承受至少 60 秒阻塞（ADR-002 的要求）"
passfail "FAIL = claude 未等待就自行繼續、決策無效、或 <60s 即超時"

writeto "A3"
echo

# ─── A4: JSONL 即時 flush 顆粒度 ────────────────────────────────────────────
header "A4 — 互動 session JSONL tail 近即時性與 tool_use 落檔顆粒"

step "開啟兩個終端"
note "終端 A（tail 觀察者）："
note ""
note "  # 先啟動互動 claude（終端 B），取得 session 對應的 JSONL 路徑，再回來設定"
note "  # 可以從 A2 的 payload 中的 transcript_path 取得路徑"
note "  # 或手動找："
note "  ls -lt ~/.claude/projects/ | head -5  # 找最近修改的目錄"
note "  JSONL=<上面找到的 .jsonl 路徑>"
note "  tail -f \"\$JSONL\""
note ""
note "終端 B（互動 claude）："
note ""
note "  mkdir -p /tmp/spike-011-a4 && cd /tmp/spike-011-a4"
note "  claude"
note ""
note "在 TUI 中要求執行工具（例如：list the files in /tmp/spike-011-a4）"
note "觀察終端 A 的 tail 輸出何時出現新內容。"
note ""

observe "工具呼叫（tool_use）執行開始後，JSONL 多快出現對應記錄？（秒數）"
observe "工具回傳後，tool_result 多快落檔？"
observe "是逐筆即時寫入，還是 session 結束才批次寫入？"
observe "有無中間狀態（tool_use 開始 → 執行中 → tool_result 三段逐步出現）？"

passfail "PASS = tool_use 開始後 <2 秒出現在 JSONL，tool_result 在工具完成後 <2 秒落檔"
passfail "FAIL = 直到 session 結束才批次寫入（tail 無即時更新）"
passfail "PARTIAL = 有更新但延遲 >2 秒，記錄實際延遲數值"

writeto "A4"
echo

# ─── A5: pending permission 暫態是否入 JSONL ──────────────────────────────
header "A5 — pending permission 暫態是否出現在 JSONL（決定 UI 狀態靠 hook 還是 tail）"

step "設定長阻塞 hook 並觸發工具"
note "使用 A3 的阻塞 hook（DELAY 設為 30 秒），讓 permission 決策懸置 30 秒。"
note ""
note "  # 修改 hook 指向 /tmp/spike-011-hook-block.sh，DELAY=30"
note "  # 在另一個終端 tail JSONL："
note "  tail -f <JSONL 路徑>"
note ""
note "在互動 claude 中要求工具執行，觸發 hook，"
note "在 hook 阻塞的 30 秒內，觀察 JSONL 的變化。"
note ""

observe "在 hook 等待期間（permission 還沒決定時），JSONL 是否出現 tool_use 暫態記錄？"
observe "JSONL 記錄是在 hook 決策前、還是決策後才落檔？"
observe "這個觀察決定了 ADR-011 的設計：若暫態不入 JSONL，UI 的 pending 狀態必須"
observe "  完全依賴 PreToolUse hook 推送（而非 tail JSONL）。"

passfail "PASS (推測) = pending permission 暫態不入 JSONL"
passfail "FAIL (反轉假設) = JSONL 出現 tool_use 暫態（決策前就有紀錄）"

writeto "A5"
echo

# ─── 清理提示 ─────────────────────────────────────────────────────────────────
header "Spike 完成後的清理"

step "還原 ~/.claude/settings.json"
note "  cp ~/.claude/settings.json.bak.spike011 ~/.claude/settings.json"
note ""

step "清理臨時目錄"
note "  rm -rf /tmp/spike-011-a1 /tmp/spike-011-a2 /tmp/spike-011-a4"
note "  rm -f /tmp/spike-011-hook.sh /tmp/spike-011-hook-block.sh"
note "  rm -f /tmp/spike-011-hook-payload.json /tmp/spike-011-hook-block-payload.json"
note ""

echo "=== 全部指引輸出完畢 ==="
echo "請依據各項觀察把結果填入 $RESULTS_JSON"
echo "對應欄位：observed (觀察到什麼)、verdict (PASS/FAIL/PARTIAL)、timestamp (ISO 8601)、claude_version"
echo
