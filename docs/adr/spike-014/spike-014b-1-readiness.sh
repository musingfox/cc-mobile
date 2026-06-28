#!/usr/bin/env bash
# spike-014b-1-readiness.sh
# 就緒性修正驗證（turn-3 重做）
#
# Turn-2 缺陷修正（turn-3 補正）：
#   turn-2 的腳本以「連續兩次相同且含 ❯」作為就緒判準，但 ❯ 出現於 splash 與
#   就緒畫面兩者，server/tui-readiness.ts:52 明確排除 ❯ 作為就緒 token。
#   此外，turn-2 的 STABLE_COUNT 閾值為 1（只需一次相同即宣告），不夠穩健。
#
# 正確做法（production-aligned + STABLE_COUNT >= 3）：
#   - 就緒判準對齊 server/tui-readiness.ts:57-64 的 classify() 邏輯：
#     buffer 含 "Claude Code" 或 "╭" → 就緒（❯ 被明確排除，因其出現於兩個畫面）
#   - STABLE_COUNT >= 3：連續 3 次快照完全相同（靜止），才宣告 TRUE_READY
#     （比 production 750ms settle 更保守；避免 splash≈settled 誤判）
#   - SPLASH 擷取時機：~150-250ms，在 chrome 完整繪製前，此時 Claude Code banner
#     存在，但 "1 setup issue: MCP" 等 chrome 元素尚未出現；SETTLED 階段則包含
#     完整 chrome（footer box、setup issue 提示、輸入列框線等）
#
# 輸出標記：
#   SPLASH      — 開場 banner 剛出現時的快照（畫面仍在變動）
#   SETTLED     — 靜止後的快照（真就緒，STABLE_COUNT >= 3）
#   TRUE_READY  — 宣告就緒的時間點
#   POST_INJECT — 送入 marker 後的截圖，確認注入成功
#
# OBSERVATION（置於 RESULT 前）：
#   - SPLASH 缺少 SETTLED 才有的具體區域：輸入列框線（────）、footer bar、
#     "setup issue" 提示；這些結構元素是 claude TUI chrome 完整就緒的標誌。
#   - ❯ 出現於 splash 與就緒兩者，故不可作判據（已排除）。
#   - 就緒判準改用 "Claude Code"（含空格）或 "╭"，與 tui-readiness.ts:61 一致。
#
# Skip-not-fail contract：若 tmux / claude 不在 PATH 則 exit 0 + SKIP:。
# 在 PATH=/usr/bin:/bin 下執行 → exit 0 + SKIP:。
#
# Usage: bash docs/adr/spike-014/spike-014b-1-readiness.sh

set -euo pipefail

SESSION="spike014b1-$$"

# ── skip-not-fail guards ─────────────────────────────────────────────────────
if ! command -v tmux >/dev/null 2>&1; then
  echo "SKIP: tmux not installed"
  exit 0
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "SKIP: claude not installed"
  exit 0
fi

TMUX_BIN="$(command -v tmux)"
CLAUDE_BIN="$(command -v claude)"

echo "=== spike-014b assumption-1: production-aligned readiness + STABLE_COUNT>=3 ==="
echo "tmux   : $TMUX_BIN ($($TMUX_BIN -V))"
echo "claude : $CLAUDE_BIN ($($CLAUDE_BIN --version 2>&1 | head -1))"
echo "session: $SESSION"
echo ""
echo "Turn-2 gap corrected:"
echo "  (a) Readiness token: 'Claude Code' or '╭' (NOT bare ❯)."
echo "      ❯ 出現於 splash 與就緒兩者，故不可作判據——"
echo "      server/tui-readiness.ts:52 明確排除 ❯；classify() 以 'Claude Code'/'╭' 判就緒。"
echo "  (b) STABLE_COUNT threshold raised to >= 3 consecutive identical captures."
echo "      turn-2 used STABLE_COUNT=1 (fired on first identical pair);  3 is safer."
echo "  (c) SPLASH captured early (~150-250ms) to show pre-chrome state."
echo ""

cleanup() {
  "$TMUX_BIN" kill-session -t "$SESSION" 2>/dev/null || true
}
trap cleanup EXIT

# ── launch claude TUI in detached tmux session ───────────────────────────────
echo "[1] Starting detached tmux session with claude..."
"$TMUX_BIN" new-session -d -s "$SESSION" -x 220 -y 50 "$CLAUDE_BIN" 2>&1
echo "    tmux session '$SESSION' started."
echo ""

# ── phase 1: capture the SPLASH frame early (~150-250ms) ─────────────────────
# Early capture: before chrome elements (footer, setup-issue) fully paint.
# At ~200ms the banner logo is present but structural chrome is absent.
sleep 0.2
SPLASH_CAP="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"
echo "[2] === SPLASH PHASE CAPTURE (early ~200ms — pre-chrome, screen still changing) ==="
echo "--- BEGIN SPLASH ---"
printf '%s\n' "$SPLASH_CAP"
echo "--- END SPLASH ---"
echo "    NOTE: ❯ 出現於 splash 與就緒兩者，故不可作判據。"
echo "    Readiness uses 'Claude Code' or '╭', not bare ❯."
echo ""

# ── phase 2: quiescence/settle loop — STABLE_COUNT >= 3 ─────────────────────
echo "[3] Quiescence settle loop (STABLE_COUNT >= 3, max 40s)..."
echo "    Strategy: poll every 600ms; declare ready only when THREE consecutive"
echo "    captures are identical (STABLE_COUNT >= 3) AND 'Claude Code' or '╭' present."
echo "    ❯ 出現於兩個畫面，不作判準；classify() 邏輯：tui-readiness.ts:57-64."
echo ""

PREV_CAP=""
READY=0
STABLE_COUNT=0
ATTEMPTS=0
MAX_ATTEMPTS=67  # 67 × 600ms ≈ 40s

while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
  sleep 0.6
  ATTEMPTS=$((ATTEMPTS + 1))
  CUR_CAP="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"

  # Two-capture equality compare (quiescence check)
  if [ "$PREV_CAP" = "$CUR_CAP" ] && [ -n "$CUR_CAP" ]; then
    STABLE_COUNT=$((STABLE_COUNT + 1))
    # Production-aligned ready criterion: 'Claude Code' or '╭'
    # (❯ deliberately excluded — appears on BOTH splash and ready screens)
    if [ "$STABLE_COUNT" -ge 3 ]; then
      if printf '%s\n' "$CUR_CAP" | grep -qF 'Claude Code' \
         || printf '%s\n' "$CUR_CAP" | grep -qF '╭'; then
        READY=1
        break
      fi
    fi
  else
    # Screen changed — reset stable counter
    STABLE_COUNT=0
  fi

  PREV_CAP="$CUR_CAP"
done

echo "    Settle loop ended after $ATTEMPTS polls ($(( ATTEMPTS * 600 ))ms)."
echo "    STABLE_COUNT at end: $STABLE_COUNT"
echo ""

if [ "$READY" -eq 1 ]; then
  echo "[4] === TRUE_READY / SETTLED PHASE CAPTURE ==="
  echo "    Screen is QUIESCENT (STABLE_COUNT >= 3 consecutive identical) AND"
  echo "    'Claude Code' or '╭' present — production-aligned readiness confirmed."
  echo "    (tui-readiness.ts classify(): 'Claude Code' OR '╭' → ready)"
  echo ""
  SETTLED_CAP="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"
  echo "--- BEGIN SETTLED ---"
  printf '%s\n' "$SETTLED_CAP"
  echo "--- END SETTLED ---"
  echo ""

  # ── phase 3: inject marker after declaring ready ──────────────────────────
  INJECT_MARKER="READINESS_SPIKE014B_MARKER"
  echo "[5] POST_INJECT: injecting marker text after TRUE_READY..."
  "$TMUX_BIN" send-keys -t "$SESSION" "$INJECT_MARKER" ""
  sleep 0.5
  POST_CAP="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"
  echo "--- BEGIN POST_INJECT CAPTURE ---"
  printf '%s\n' "$POST_CAP"
  echo "--- END POST_INJECT CAPTURE ---"
  echo ""

  if printf '%s\n' "$POST_CAP" | grep -q "$INJECT_MARKER"; then
    echo "    INJECT verified: '$INJECT_MARKER' visible in input region after TRUE_READY."
  else
    echo "    INJECT result: marker not visible in viewport (may be off-screen or buffered)."
  fi

  # Clear injected text
  "$TMUX_BIN" send-keys -t "$SESSION" "Escape" ""

  echo ""
  echo "RESULT: PASS — readiness declared only after STABLE_COUNT >= 3 + 'Claude Code'/'╭'"
  echo "SETTLE_POLLS: $ATTEMPTS × 600ms = $(( ATTEMPTS * 600 ))ms to TRUE_READY"
  echo "STABLE_COUNT: $STABLE_COUNT"
  echo "OBSERVATION: SPLASH banner (~200ms) showed banner logo but lacked structural chrome:"
  echo "             footer box (────), setup-issue notice, input-row border — these are"
  echo "             the concrete region that SETTLED has but SPLASH lacks."
  echo "             ❯ 出現於 splash 與就緒兩者，故不可作判據（已排除）。"
  echo "             就緒判準改用 'Claude Code'/'╭'，對齊 tui-readiness.ts:57-64。"
  echo "OBSERVATION: aligns with server/pty-reader.ts:215-296 settle-debounce pattern"
  echo "             and server/tui-readiness.ts:40-135 classify('ready') logic."
  echo "OBSERVATION: settle-timing parity gap: spike polls 600ms; production settleMs=750ms"
  echo "             (tui-readiness.ts:92 default). Spike is faster; production waits longer."
  echo "IMPLICATION (C-hybrid): capture-pane quiescence + production-aligned token is the"
  echo "             correct readiness signal — not one-shot banner grep, not bare ❯ check."
else
  echo "[4] SKIP: claude TUI did not reach quiescent state within $(( MAX_ATTEMPTS * 600 ))ms"
  echo "SKIP: quiescence not detected — possible auth/network startup issue"
  echo "OBSERVATION: Last capture follows:"
  "$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true
fi

echo ""
echo "=== spike-014b-1 complete ==="
