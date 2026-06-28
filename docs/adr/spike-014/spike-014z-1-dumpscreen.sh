#!/usr/bin/env bash
# spike-014z-1-dumpscreen.sh
# Zellij equivalent of spike-014-1-capture-pane.sh
#
# Assumption 1 (zellij): zellij action dump-screen can read claude TUI readiness
# without direct PTY onData, using ZELLIJ_SESSION_NAME env var for out-of-session
# targeting.
#
# Key discovery from probing:
#   - `zellij attach -b <name>` creates a headless background session
#   - `ZELLIJ_SESSION_NAME=<name> zellij action <cmd> --pane-id <id>` targets from outside
#   - There is NO --session flag on `zellij action`; env var is the workaround
#   - `zellij action list-panes` reveals pane IDs (terminal_0, plugin_0, etc.)
#   - `zellij action dump-screen --pane-id <id>` prints viewport to stdout
#
# Skip-not-fail: if zellij or claude absent, exit 0 + print SKIP.
#
# Usage: bash docs/adr/spike-014/spike-014z-1-dumpscreen.sh

set -euo pipefail

ZELLIJ_BIN="/opt/homebrew/bin/zellij"
CLAUDE_BIN="${HOME}/.local/bin/claude"
SESSION="spike014z1-$$"

# ── skip-not-fail guards ─────────────────────────────────────────────────────
if ! command -v "$ZELLIJ_BIN" >/dev/null 2>&1; then
  echo "SKIP: zellij not installed"
  exit 0
fi
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  echo "SKIP: claude not installed"
  exit 0
fi

echo "=== Spike 014z-1: zellij dump-screen TUI readiness ==="
echo "zellij : $ZELLIJ_BIN ($($ZELLIJ_BIN --version))"
echo "claude : $CLAUDE_BIN ($($CLAUDE_BIN --version 2>&1 | head -1))"
echo "session: $SESSION"
echo ""

cleanup() {
  "$ZELLIJ_BIN" kill-session "$SESSION" 2>/dev/null || true
}
trap cleanup EXIT

# ── [1] Create background zellij session ─────────────────────────────────────
echo "[1] Creating background zellij session '$SESSION'..."
# attach -b creates a detached session in the background if one does not exist
"$ZELLIJ_BIN" attach -b "$SESSION" 2>&1 &
BGPID=$!
sleep 3
echo "    Background PID: $BGPID"

# Verify session exists
SESSIONS=$("$ZELLIJ_BIN" list-sessions 2>&1 || true)
echo "    Active sessions: $SESSIONS"

# ── [2] Get the terminal pane ID ──────────────────────────────────────────────
echo ""
echo "[2] Discovering terminal pane ID..."
PANE_LIST=$(ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action list-panes 2>&1)
echo "    Panes: $PANE_LIST"
TERM_PANE=$(echo "$PANE_LIST" | grep terminal | awk '{print $1}' | head -1)
echo "    Using pane: $TERM_PANE"

# ── [3] Launch claude via write-chars ────────────────────────────────────────
echo ""
echo "[3] Launching claude inside zellij via write-chars..."
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write-chars --pane-id "$TERM_PANE" "$CLAUDE_BIN" 2>&1
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write --pane-id "$TERM_PANE" 13 2>&1
echo "    Sent: '$CLAUDE_BIN' + Enter (byte 13)"

# ── [4] Poll dump-screen for TUI readiness ───────────────────────────────────
echo ""
echo "[4] Polling dump-screen for TUI readiness (max 30s, 0.5s intervals)..."
READY=0
ATTEMPTS=0
MAX_ATTEMPTS=60  # 60 × 500ms = 30s

while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
  SCREEN=$(ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>/dev/null || true)
  ATTEMPTS=$((ATTEMPTS + 1))

  # Claude TUI shows "❯" prompt or "Claude Code" or "╭" box when ready
  if printf '%s\n' "$SCREEN" | grep -qE '❯|Claude Code|╭|auto mode'; then
    READY=1
    break
  fi
  sleep 0.5
done

echo "    Polled $ATTEMPTS times ($(( ATTEMPTS * 500 ))ms)"
echo ""

# ── [5] Capture and display final screen ──────────────────────────────────────
echo "[5] Final dump-screen output:"
echo "--- BEGIN DUMP ---"
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>&1 || true
echo "--- END DUMP ---"
echo ""

# ── [6] Report ────────────────────────────────────────────────────────────────
if [ "$READY" -eq 1 ]; then
  echo "=== FINDINGS ==="
  echo "RESULT: PASS"
  echo "- TUI readiness detected after $ATTEMPTS × 500ms = $(( ATTEMPTS * 500 ))ms"
  echo "- ZELLIJ_SESSION_NAME env var is required for out-of-session action targeting"
  echo "- attach -b creates headless session (no TTY needed); equivalent to tmux new-session -d"
  echo "- list-panes reveals pane IDs; terminal_0 is the initial shell pane"
  echo "- dump-screen --pane-id <id> prints viewport to stdout cleanly"
  echo "- No --session flag on 'zellij action'; env var is the only cross-session mechanism"
  echo "- Awkward vs tmux: extra step to discover pane-id; env var workaround not documented clearly"
else
  echo "=== FINDINGS ==="
  echo "RESULT: PARTIAL — zellij session created, dump-screen functional, TUI readiness timed out"
  echo "- attach -b + dump-screen works mechanically"
  echo "- claude TUI not detected within 30s (may need more time or different readiness pattern)"
fi

echo ""
echo "=== spike-014z-1 complete ==="
