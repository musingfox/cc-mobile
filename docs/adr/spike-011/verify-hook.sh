#!/usr/bin/env bash
# verify-hook.sh — ADR-011 spike A2/A3：驗 PreToolUse hook 在「互動 PTY/TUI 模式」會不會觸發
#
# 回答三個 permission 地基問題（只有你本人手動跑真 claude 才算數）：
#   A2-1  互動模式下 claude 要用工具時，PreToolUse hook 會不會被呼叫？
#   A2-2  hook 收到的 payload 是否含 session_id / transcript_path / tool_name / tool_input？
#   A3    hook 回 permissionDecision:"deny" 能不能真的擋下工具？
#
# 設定格式依官方文件 code.claude.com/docs/en/hooks 確認，非憑記憶。
# 用法：
#   bash docs/adr/spike-011/verify-hook.sh            # 建環境 + 印指示
#   bash docs/adr/spike-011/verify-hook.sh --check DIR # 手動跑完後分析 log
set -euo pipefail
BOLD=$'\033[1m'; R=$'\033[0m'; Y=$'\033[33m'; G=$'\033[32m'; RED=$'\033[31m'

# ── --check 模式：分析既有測試目錄的 payload log ──────────────────────────
if [[ "${1:-}" == "--check" ]]; then
  DIR="${2:?用法: verify-hook.sh --check <測試目錄>}"
  LOG="$DIR/hook-payload.log"
  echo "${BOLD}=== 檢查 $LOG ===${R}"
  if [[ ! -f "$LOG" ]]; then
    echo "${RED}[A2-1] FAIL：log 不存在 → hook 在互動模式沒有被觸發。${R}"
    echo "  （或 claude 沒用到 Bash 工具。確認步驟 2 的 prompt 有要求跑 bash。）"
    exit 0
  fi
  echo "${G}[A2-1] PASS：hook 有被觸發（log 已生成）。${R}"
  echo ""
  echo "${BOLD}payload 內容：${R}"; cat "$LOG"
  echo ""
  echo "${BOLD}[A2-2] payload 欄位檢查：${R}"
  for f in session_id transcript_path cwd tool_name tool_input permission_mode hook_event_name; do
    if grep -q "\"$f\"" "$LOG"; then echo "  ${G}[有]${R} $f"; else echo "  ${RED}[缺]${R} $f"; fi
  done
  echo ""
  echo "${BOLD}[A3] deny 是否生效？${R} 看你剛剛 claude 的反應："
  echo "  - 若 claude 說工具被擋/denied/blocked、且沒真的執行 echo → ${G}deny 生效${R}"
  echo "  - 若 echo 照常跑了 → deny 沒生效，需再查"
  echo ""
  echo "把上面 payload + claude 反應貼回來。清理：rm -rf '$DIR'"
  exit 0
fi

# ── 建立隔離測試環境 ──────────────────────────────────────────────────────
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cc-hook-spike-XXXXXX")"
LOG="$WORK/hook-payload.log"
mkdir -p "$WORK/.claude/hooks"

cat > "$WORK/.claude/hooks/log-and-deny.sh" <<HOOK
#!/usr/bin/env bash
PAYLOAD="\$(cat)"
{ echo "===== PreToolUse fired @ \$(date '+%H:%M:%S') ====="; echo "\$PAYLOAD"; echo ""; } >> "$LOG"
cat <<JSON
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "spike: prove hook fires + can deny" } }
JSON
HOOK
chmod +x "$WORK/.claude/hooks/log-and-deny.sh"

cat > "$WORK/.claude/settings.json" <<JSON
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "$WORK/.claude/hooks/log-and-deny.sh" } ] }
    ]
  }
}
JSON

echo "${BOLD}=== ADR-011 spike A2/A3：PreToolUse hook 互動模式驗證 ===${R}"
echo ""
echo "已建好隔離測試環境："
echo "  專案目錄  : $WORK"
echo "  hook 設定 : $WORK/.claude/settings.json (PreToolUse matcher=Bash → log-and-deny.sh，回 deny)"
echo "  payload log: $LOG"
echo ""
echo "${BOLD}${Y}請照做（你本人手動驅動 claude，human-in-the-loop）：${R}"
echo ""
echo "  1. 開新終端，進測試目錄啟動互動 claude（fish）："
echo "       ${BOLD}cd $WORK; and claude${R}"
echo "     若跳「信任此資料夾」選 Yes。"
echo ""
echo "  2. 在 claude 裡打一句會用到 Bash 工具的話："
echo "       ${BOLD}Run this bash command: echo hello-from-tool${R}"
echo ""
echo "  3. 觀察 claude：它說工具被 hook 擋下/denied 了嗎？還是照常跑了 echo？"
echo ""
echo "  4. 回這個終端跑檢查："
echo "       ${BOLD}bash docs/adr/spike-011/verify-hook.sh --check '$WORK'${R}"
echo ""
echo "  5. 清理：rm -rf '$WORK'"
echo ""
echo "（把 claude 的反應 + --check 輸出貼回來，我幫你判讀。）"
