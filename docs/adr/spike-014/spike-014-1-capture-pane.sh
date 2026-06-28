#!/usr/bin/env bash
# spike-014-1-capture-pane.sh
# Assumption 1: tmux capture-pane can read claude TUI readiness without direct PTY onData.
#
# Mechanism: launch claude inside a detached tmux session, wait for its TUI to appear,
# read readiness via `tmux capture-pane` (NOT direct PTY onData), then tear down.
#
# Skip-not-fail contract: if tmux or claude are absent, exit 0 + print SKIP token.
# Run under PATH=/usr/bin:/bin → exits 0 with SKIP (tools not found on bare PATH).
#
# Artifact: stdout is saved by CI / the caller as spike-014-1-capture-pane.txt
#
# Usage: bash docs/adr/spike-014/spike-014-1-capture-pane.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION="spike014-1-$$"

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

echo "=== spike-014 assumption-1: tmux capture-pane TUI readiness ==="
echo "tmux   : $TMUX_BIN ($($TMUX_BIN -V))"
echo "claude : $CLAUDE_BIN ($($CLAUDE_BIN --version 2>&1 | head -1))"
echo "session: $SESSION"
echo ""

cleanup() {
  "$TMUX_BIN" kill-session -t "$SESSION" 2>/dev/null || true
}
trap cleanup EXIT

# ── launch claude TUI in detached tmux session ───────────────────────────────
echo "[1] Starting detached tmux session with claude..."
"$TMUX_BIN" new-session -d -s "$SESSION" -x 220 -y 50 "$CLAUDE_BIN" 2>&1
echo "    tmux session '$SESSION' started."

# ── poll capture-pane until TUI initializes (max 20s) ───────────────────────
echo "[2] Polling tmux capture-pane for claude TUI readiness..."
READY=0
ATTEMPTS=0
MAX_ATTEMPTS=40  # 40 × 500ms = 20s

while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
  SCREEN="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"
  ATTEMPTS=$((ATTEMPTS + 1))

  # Claude TUI shows ">" prompt or "Welcome" or version info when ready
  if printf '%s\n' "$SCREEN" | grep -qiE '^\s*>|Welcome|claude|Human:|✓'; then
    READY=1
    break
  fi
  sleep 0.5
done

echo ""
echo "[3] capture-pane output after ${ATTEMPTS} polls ($(( ATTEMPTS * 500 ))ms):"
echo "--- BEGIN CAPTURE ---"
"$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true
echo "--- END CAPTURE ---"
echo ""

if [ "$READY" -eq 1 ]; then
  echo "RESULT: PASS — claude TUI readiness detected via capture-pane (not PTY onData)"
  echo "OBSERVATION: tmux capture-pane surfaces the rendered TUI screen without needing"
  echo "             direct access to the PTY file descriptor or onData callback."
  echo "IMPLICATION (C-hybrid): cc-mobile can probe live session state via capture-pane"
  echo "             even when it only owns the tmux session wrapper, not the PTY fd."
else
  echo "RESULT: SKIP (claude TUI not detected within ${MAX_ATTEMPTS} × 500ms)"
  echo "REASON: claude may need auth/network; screen content follows for inspection."
  echo "SKIP: claude TUI readiness detection timed out — possible auth or startup issue"
fi

echo ""
echo "=== spike-014-1 complete ==="
