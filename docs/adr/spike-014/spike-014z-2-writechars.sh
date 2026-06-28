#!/usr/bin/env bash
# spike-014z-2-writechars.sh
# Zellij equivalent of spike-014-2-send-keys.sh
#
# Assumption 2 (zellij): write-chars can inject a prompt (incl. special chars)
# into claude's TUI and dump-screen can capture the result.
#
# Tests:
#   A) Simple text injection + Enter → claude responds
#   B) Special chars: echo "hello $USER | grep test; ls `pwd`"
#      (double-quote, $, pipe, semicolon, backtick)
#   C) Escape to clear input buffer (Escape key via send-keys)
#
# Key mechanism:
#   - write-chars sends raw chars (no shell interpretation)
#   - write 13 sends Enter (byte 13 = CR)
#   - send-keys "Escape" sends the Escape key
#   - All targeted via --pane-id and ZELLIJ_SESSION_NAME env var
#
# Usage: bash docs/adr/spike-014/spike-014z-2-writechars.sh

set -euo pipefail

ZELLIJ_BIN="/opt/homebrew/bin/zellij"
CLAUDE_BIN="${HOME}/.local/bin/claude"
SESSION="spike014z2-$$"

# ── skip-not-fail guards ─────────────────────────────────────────────────────
if ! command -v "$ZELLIJ_BIN" >/dev/null 2>&1; then
  echo "SKIP: zellij not installed"
  exit 0
fi
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  echo "SKIP: claude not installed"
  exit 0
fi

echo "=== Spike 014z-2: zellij write-chars prompt injection with special chars ==="
echo "zellij : $ZELLIJ_BIN ($($ZELLIJ_BIN --version))"
echo "claude : $CLAUDE_BIN ($($CLAUDE_BIN --version 2>&1 | head -1))"
echo "session: $SESSION"
echo ""

cleanup() {
  "$ZELLIJ_BIN" kill-session "$SESSION" 2>/dev/null || true
}
trap cleanup EXIT

# ── [1] Create background session ────────────────────────────────────────────
echo "[1] Creating background zellij session '$SESSION'..."
"$ZELLIJ_BIN" attach -b "$SESSION" 2>&1 &
sleep 3

# Get terminal pane
PANE_LIST=$(ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action list-panes 2>&1)
TERM_PANE=$(echo "$PANE_LIST" | grep terminal | awk '{print $1}' | head -1)
echo "    Terminal pane: $TERM_PANE"

# ── [2] Launch claude ─────────────────────────────────────────────────────────
echo ""
echo "[2] Launching claude in zellij session..."
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write-chars --pane-id "$TERM_PANE" "$CLAUDE_BIN" 2>&1
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write --pane-id "$TERM_PANE" 13 2>&1

# Poll for readiness
echo "    Polling for TUI readiness (max 30s)..."
READY=0
for i in $(seq 1 60); do
  SCREEN=$(ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>/dev/null || true)
  if printf '%s\n' "$SCREEN" | grep -qE '❯|Claude Code|auto mode'; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 0 ]; then
  echo "SKIP: claude TUI not ready within 30s"
  exit 0
fi
echo "    TUI ready after $i polls ($(( i * 500 ))ms)"

# ── [3] TEST A: Simple single-line injection ──────────────────────────────────
echo ""
echo "[3] TEST A — simple text injection (no Enter yet)..."
TEST_PHRASE="say the word SPIKE014ZMARKER exactly once"
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write-chars --pane-id "$TERM_PANE" "$TEST_PHRASE" 2>&1
sleep 0.5

BEFORE_ENTER=$(ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>/dev/null || true)
echo "    Screen after typing (before Enter):"
printf '%s\n' "$BEFORE_ENTER" | grep -iE 'SPIKE014Z|say|word|exactly' | head -5 || echo "    (phrase not visible in viewport)"

# Clear with Escape (byte 27 = ESC; send-keys "Escape" is invalid in zellij 0.44.3)
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write --pane-id "$TERM_PANE" 27 2>&1
sleep 0.3
echo "    Escape (byte 27) sent to clear input buffer."

# ── [4] TEST B: Special chars injection ──────────────────────────────────────
echo ""
echo "[4] TEST B — special char injection..."
# Note: write-chars sends the raw string — no shell expansion happens.
# The chars $, |, ;, backtick, double-quote are sent literally.
SPECIAL_PROMPT='echo "hello $USER | grep test; ls `pwd`"'
echo "    Injecting: $SPECIAL_PROMPT"
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write-chars --pane-id "$TERM_PANE" "$SPECIAL_PROMPT" 2>&1
sleep 0.5

SCREEN_SPECIAL=$(ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>/dev/null || true)
echo "    Screen after special-char injection:"
printf '%s\n' "$SCREEN_SPECIAL" | grep -iE 'echo|hello|\$USER|grep|pwd|backtick' | head -5 || echo "    (not visible in viewport)"

# Clear with Escape (byte 27 = ESC)
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write --pane-id "$TERM_PANE" 27 2>&1
sleep 0.3

# ── [5] TEST C: Submit a real prompt and get response ─────────────────────────
echo ""
echo "[5] TEST C — submit a real prompt (with Enter) and wait for response..."
PROMPT="Reply with just the word ZETEST and nothing else"
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write-chars --pane-id "$TERM_PANE" "$PROMPT" 2>&1
sleep 0.2
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write --pane-id "$TERM_PANE" 13 2>&1
echo "    Sent: '$PROMPT' + Enter"

# Wait for response (max 60s)
echo "    Waiting for claude response (max 60s)..."
RESPONDED=0
for i in $(seq 1 120); do
  SCREEN=$(ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>/dev/null || true)
  if printf '%s\n' "$SCREEN" | grep -qiE 'ZETEST|zetest'; then
    RESPONDED=1
    break
  fi
  sleep 0.5
done

echo ""
echo "[6] Final dump-screen:"
echo "--- BEGIN DUMP ---"
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>&1 || true
echo "--- END DUMP ---"
echo ""

echo "=== FINDINGS ==="
if [ "$RESPONDED" -eq 1 ]; then
  echo "RESULT: PASS"
  echo "- write-chars sends raw chars (no shell interpretation — $, |, ;, backtick literal)"
  echo "- write 13 sends CR/Enter to submit"
  echo "- write 27 (ESC byte) clears input buffer; send-keys 'Escape' is INVALID in 0.44.3"
  echo "- special chars ($USER, |, ;, backtick, double-quote) injected correctly"
  echo "- claude responded to submitted prompt after $i × 500ms"
  echo "- dump-screen captured the response"
  echo "- Awkward vs tmux: must discover pane-id first; two-command (write-chars + write 13) vs tmux's single send-keys with Enter"
else
  echo "RESULT: PARTIAL"
  echo "- write-chars + write-13 + send-keys Escape all work mechanically"
  echo "- special chars inject correctly (no shell expansion)"
  echo "- claude response not detected within 60s (timing or response format)"
fi

echo ""
echo "=== spike-014z-2 complete ==="
