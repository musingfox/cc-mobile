#!/usr/bin/env bash
# install-pty-hook.sh — 把 ADR-011 的 PreToolUse permission hook 裝進一個測試專案，
# 讓 6/11 的端到端 live E2E（真 claude → hook → server → 手機 → 決策 → 回 hook）跑得起來。
#
# 這是 EX-11 的前置門檻（turn-15 Divergence 點名）：hook 不裝，PTY 模式下 claude 要用
# 工具時 permission 請求不會被送到手機 —— claude 的 TUI 會自己吃掉權限提問（PTY hang），
# 或工具直接跑掉，permission bridge（P2 整個存在的理由）根本沒被測到。
#
# 用法：
#   bash docs/adr/spike-011/install-pty-hook.sh <測試專案目錄> [PERMISSION_URL]
#   bash docs/adr/spike-011/install-pty-hook.sh --uninstall <測試專案目錄>
#
# 例（dev server :3001，預設 URL）：
#   bash docs/adr/spike-011/install-pty-hook.sh ~/work/pty-live-test
# 例（prod server :7701）：
#   bash docs/adr/spike-011/install-pty-hook.sh ~/work/pty-live-test http://localhost:7701/api/pty-permission
set -euo pipefail
BOLD=$'\033[1m'; R=$'\033[0m'; G=$'\033[32m'; Y=$'\033[33m'; RED=$'\033[31m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HOOK="$REPO_ROOT/server/pty-permission-hook.ts"
STOP_HOOK="$REPO_ROOT/server/pty-stop-hook.ts"

# ── uninstall ──────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--uninstall" ]]; then
  DIR="${2:?用法: install-pty-hook.sh --uninstall <測試專案目錄>}"
  SETTINGS="$DIR/.claude/settings.json"
  if [[ -f "$SETTINGS.ccmobile-bak" ]]; then
    mv "$SETTINGS.ccmobile-bak" "$SETTINGS"
    echo "${G}已還原原 settings.json（從 .ccmobile-bak）。${R}"
  elif [[ -f "$SETTINGS" ]]; then
    rm -f "$SETTINGS"
    echo "${G}已移除 ${SETTINGS}（無原始備份）。${R}"
  else
    echo "${Y}找不到 ${SETTINGS}，無需移除。${R}"
  fi
  exit 0
fi

DIR="${1:?用法: install-pty-hook.sh <測試專案目錄> [PERMISSION_URL]}"
URL="${2:-http://localhost:3001/api/pty-permission}"
# Stop-hook response URL: same host/port as the permission URL, /api/pty-response path.
RESPONSE_URL="${URL%/api/pty-permission}/api/pty-response"

# ── 前置檢查 ────────────────────────────────────────────────────────────────
[[ -f "$HOOK" ]] || { echo "${RED}找不到 hook script: $HOOK${R}"; exit 1; }
command -v bun >/dev/null || { echo "${RED}bun 不在 PATH（hook command 需要 bun）。${R}"; exit 1; }

if [[ ! -d "$DIR" ]]; then
  echo "${Y}目錄不存在，建立：$DIR${R}"
  mkdir -p "$DIR"
fi
DIR="$(cd "$DIR" && pwd)"   # 絕對化
SETTINGS="$DIR/.claude/settings.json"
mkdir -p "$DIR/.claude"

# 既有 settings.json → 備份再覆寫（避免無聲 clobber）
if [[ -f "$SETTINGS" && ! -f "$SETTINGS.ccmobile-bak" ]]; then
  cp "$SETTINGS" "$SETTINGS.ccmobile-bak"
  echo "${Y}既有 settings.json 已備份到 $SETTINGS.ccmobile-bak（--uninstall 可還原）。${R}"
fi

# matcher=Bash：第一次 live 用秒級 Bash 工具（如 ls/echo），對齊 H2「選秒級工具」條件。
# Stop hook（matcher 空＝所有 stop）：把 last_assistant_message 回傳 server，作為 PTY 讀回管道
# （ADR-011，claude v2.1.177 互動 session 不 flush JSONL，故不可 poll getSessionMessages）。
cat > "$SETTINGS" <<JSON
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "CC_MOBILE_PERMISSION_URL='$URL' bun '$HOOK'" }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "CC_MOBILE_RESPONSE_URL='$RESPONSE_URL' bun '$STOP_HOOK'" }
        ]
      }
    ]
  }
}
JSON

echo "${BOLD}${G}✓ PreToolUse + Stop hook 已裝。${R}"
echo "  測試專案 : $DIR"
echo "  settings : $SETTINGS"
echo "  perm hook: bun $HOOK"
echo "  stop hook: bun $STOP_HOOK"
echo "  POST 至  : $URL"
echo "  回應 POST: $RESPONSE_URL"
echo ""
echo "${BOLD}${Y}關鍵前置（live 跑起來的必要條件）：${R}"
echo "  1. server 要跑著，且其 ${BOLD}CC_MOBILE_ALLOWED_ROOTS${R} 必須包含上面測試專案目錄"
echo "     （否則 pty_send 會被沙箱以 path_not_allowed 擋掉）。"
echo "       dev :  CC_MOBILE_ALLOWED_ROOTS='$DIR' bun run dev:server"
echo "  2. 上面 POST URL 要對應你實際跑的 server（dev :3001 / prod :7701）。"
echo "  3. 手機 PWA 連上同一台 server、開一個 cwd=測試專案的 session。"
echo ""
echo "完整步驟見：${BOLD}docs/adr/spike-011/LIVE-E2E-runbook.md${R}"
echo "移除：bash docs/adr/spike-011/install-pty-hook.sh --uninstall '$DIR'"
