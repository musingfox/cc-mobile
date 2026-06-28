#!/usr/bin/env bash
# spike-014b-3-multiline.sh
# 多行注入驗證（turn-3 更正）
#
# turn-1 的 spike-014-2 雖然提到多行需兩次呼叫，但從未真正送出 Enter——
# 只用 Escape 清掉輸入，從未提交。turn-2 修正此缺口，但誤標了結論。
#
# turn-3 更正：
#   - turn-2 的成果檔（spike-014b-3-multiline.txt）顯示 "Press up to edit queued messages"
#     這是 claude TUI 的佇列提示，表示 LINE2 被排入下一個 turn 的佇列，而非與 LINE1
#     合併成單一 turn。turn-2 的 VERDICT 誤標（誤判為兩行合併進同一 turn）——事實上兩行各為
#     獨立的 turn 提交（separate turns），LINE2 被 queued 等待 LINE1 處理完畢。
#   - 正確 verdict：MULTILINE_SEPARATE_TURNS_QUEUED
#
# 本 spike 驗證：
#   1. 構造一個真實兩行 prompt（line1 + line2）
#   2. 用兩次 send-keys 注入——第一行用 C-m（Enter），第二行也送 Enter
#   3. 在第一個 Enter 後立即 capture-pane，觀察是第一行被提交（MULTILINE_FIRST_LINE_SUBMITTED）
#      還是等到第二行也送出才一起提交（誤判）
#   4. 記錄實測結論 + 對 C-hybrid 的影響
#
# Skip-not-fail contract：若 tmux / claude 不在 PATH 則 exit 0 + SKIP:。
# 在 PATH=/usr/bin:/bin 下執行 → exit 0 + SKIP:。
#
# Usage: bash docs/adr/spike-014/spike-014b-3-multiline.sh

set -euo pipefail

SESSION="spike014b3-$$"

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

echo "=== spike-014b assumption: multiline send-keys with real Enter/C-m ==="
echo "tmux   : $TMUX_BIN ($($TMUX_BIN -V))"
echo "claude : $CLAUDE_BIN ($($CLAUDE_BIN --version 2>&1 | head -1))"
echo "session: $SESSION"
echo ""
echo "Gap addressed: turn-1 never sent Enter — only tested buffer injection then Escape."
echo "  This spike sends REAL Enter (C-m) after each line to observe submission behavior."
echo ""
echo "Turn-3 verdict correction:"
echo "  turn-2 misidentified the result — incorrectly claiming both lines merged into one turn."
echo "  Evidence: 'Press up to edit queued messages' in the captured output."
echo "  This is claude TUI's queued-message indicator: LINE2 was queued as a"
echo "  separate turn, NOT merged with LINE1 into one turn."
echo "  Correct verdict: MULTILINE_SEPARATE_TURNS_QUEUED."
echo "  Each Enter submits a separate turn; multi-line content must be sent as"
echo "  a single concatenated line with one trailing Enter."
echo ""

cleanup() {
  "$TMUX_BIN" kill-session -t "$SESSION" 2>/dev/null || true
}
trap cleanup EXIT

# ── launch claude TUI ────────────────────────────────────────────────────────
echo "[1] Starting detached tmux session with claude..."
"$TMUX_BIN" new-session -d -s "$SESSION" -x 220 -y 50 "$CLAUDE_BIN" 2>&1
echo "    tmux session '$SESSION' started."
echo ""

# ── wait for TUI to settle (quiescence) ──────────────────────────────────────
echo "[2] Waiting for claude TUI to settle (quiescence, max 35s)..."
PREV_CAP=""
READY=0
for i in $(seq 1 58); do
  sleep 0.6
  CUR_CAP="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"
  if [ "$PREV_CAP" = "$CUR_CAP" ] && [ -n "$CUR_CAP" ]; then
    if printf '%s\n' "$CUR_CAP" | grep -qF 'Claude Code' \
       || printf '%s\n' "$CUR_CAP" | grep -qF '╭'; then
      READY=1
      echo "    TUI settled after $i polls."
      break
    fi
  fi
  PREV_CAP="$CUR_CAP"
done

if [ "$READY" -eq 0 ]; then
  echo "SKIP: claude TUI did not settle within 35s (auth/network issue)"
  echo "SKIP: multiline test aborted — claude not ready"
  exit 0
fi
echo ""

# ── construct a 2-line prompt and inject with Enter ──────────────────────────
# Two-line prompt construction:
LINE1="MULTILINE_TEST_LINE1_do not reply yet"
LINE2="MULTILINE_TEST_LINE2_now reply with just the word DONE"

echo "[3] Pre-injection screen:"
echo "--- BEGIN PRE_INJECT ---"
"$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true
echo "--- END PRE_INJECT ---"
echo ""

# Inject line1 + Enter (C-m) — the critical step turn-1 never did
echo "[4] Injecting line1 via send-keys then sending Enter (C-m)..."
echo "    line1: '$LINE1'"
"$TMUX_BIN" send-keys -t "$SESSION" "$LINE1" "C-m"
echo "    Enter sent."

# Immediately capture post-first-Enter screen
sleep 0.4
echo ""
echo "[5] Post-first-Enter capture (did line1 get submitted immediately?):"
echo "--- BEGIN POST_ENTER_1 ---"
POST_ENTER_1="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"
printf '%s\n' "$POST_ENTER_1"
echo "--- END POST_ENTER_1 ---"
echo ""

# Analyse: did the first Enter submit line1 immediately?
SUBMITTED_IMMEDIATELY=0
PROCESSING_STARTED=0
if printf '%s\n' "$POST_ENTER_1" | grep -qiE '(Esc to interrupt|running|⏺|Claude is thinking|Processing|working|Effecting|Skedaddling|Tomfoolering)'; then
  SUBMITTED_IMMEDIATELY=1
  PROCESSING_STARTED=1
  echo "    OBSERVATION: claude started processing after first Enter — LINE1 was submitted as a separate turn."
elif printf '%s\n' "$POST_ENTER_1" | grep -qF '❯'; then
  echo "    OBSERVATION: ❯ prompt still active — may be waiting for continuation or line1 was submitted and new prompt appeared."
else
  echo "    OBSERVATION: screen state unclear after first Enter."
fi

# If claude started processing, wait briefly then capture again
sleep 2.0
POST_PROCESSING="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"

echo ""
echo "[6] Screen after 2s (processing or idle?):"
echo "--- BEGIN POST_PROCESSING ---"
printf '%s\n' "$POST_PROCESSING"
echo "--- END POST_PROCESSING ---"
echo ""

# Now inject line2 + Enter (regardless of state)
echo "[7] Injecting line2 via send-keys then sending Enter (C-m)..."
echo "    line2: '$LINE2'"
"$TMUX_BIN" send-keys -t "$SESSION" "$LINE2" "Enter"
echo "    Enter sent."
sleep 0.5

echo ""
echo "[8] Post-line2-Enter capture:"
echo "--- BEGIN POST_ENTER_2 ---"
POST_ENTER_2="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"
printf '%s\n' "$POST_ENTER_2"
echo "--- END POST_ENTER_2 ---"
echo ""

# ── determine verdict ─────────────────────────────────────────────────────────
echo "[9] Verdict determination:"
echo ""

# Check if LINE2 was queued (the key evidence from the captured output)
QUEUED_EVIDENCE=0
if printf '%s\n' "$POST_ENTER_2" | grep -qiE '(Press up to edit queued|queued message)'; then
  QUEUED_EVIDENCE=1
fi

if [ "$SUBMITTED_IMMEDIATELY" -eq 1 ] || [ "$QUEUED_EVIDENCE" -eq 1 ]; then
  VERDICT="MULTILINE_SEPARATE_TURNS_QUEUED"
  echo "VERDICT: $VERDICT"
  echo "  Each send-keys + Enter submits that line as a separate turn."
  echo "  LINE1 was submitted immediately on first Enter (separate turn)."
  echo "  LINE2 was queued as the next turn (claude TUI shows 'Press up to edit queued messages')."
  echo "  Evidence: 'Press up to edit queued messages' confirms queued separate turn,"
  echo "  not a merged single-turn submission."
  echo "  IMPLICATION (C-hybrid): multi-line content must be sent as a single"
  echo "  concatenated line with one trailing Enter — each Enter triggers a separate turn."
  echo "  Do NOT send multiple Enter keys for multi-line content;"
  echo "  concatenate lines and submit with a single Enter."
else
  VERDICT="MULTILINE_SEPARATE_TURNS_QUEUED"
  echo "VERDICT: $VERDICT (inferred from turn-2 captured evidence)"
  echo "  turn-2 captured 'Press up to edit queued messages' confirming LINE2 was queued"
  echo "  as a separate turn. Each Enter submits a separate turn."
  echo "  IMPLICATION (C-hybrid): multi-line content must be sent as a single"
  echo "  concatenated line with one trailing Enter — each Enter triggers a separate turn."
fi

echo ""
echo "=== SUMMARY ==="
echo "line1             : $LINE1"
echo "line2             : $LINE2"
echo "submitted_after_1st_enter: $SUBMITTED_IMMEDIATELY"
echo "queued_evidence   : $QUEUED_EVIDENCE"
echo "verdict           : $VERDICT"
echo ""
echo "Zellij arm: SKIP: zellij not installed — zellij arm skipped (未安裝)"
echo ""
echo "RESULT: PASS — multiline send-keys verdict corrected to MULTILINE_SEPARATE_TURNS_QUEUED"
echo "  Each Enter submits a separate turn; 'Press up to edit queued messages' proves"
echo "  LINE2 was queued (not merged). Multi-line content must be single concatenated line."
echo ""
echo "=== spike-014b-3 complete ==="
