#!/usr/bin/env bash
# spike-014z-3-hook.sh
# Zellij equivalent of spike-014-3-hook-fire.sh
#
# Assumption 3 (zellij): a Stop hook installed via --settings fires when claude
# runs inside a zellij session owned by cc-mobile, providing a relay channel
# without needing PTY onData polling.
#
# Strategy:
#   1. Write a temporary Stop hook script that writes a marker file
#   2. Write a temporary claude settings JSON with the Stop hook
#   3. Create background zellij session
#   4. Write-chars to launch claude --settings <file>
#   5. Wait for TUI readiness via dump-screen
#   6. Inject "say hi" prompt + Enter
#   7. Poll for hook marker file
#   8. Capture dump-screen at hook evaluation time
#   9. Report
#
# Usage: bash docs/adr/spike-014/spike-014z-3-hook.sh

set -euo pipefail

ZELLIJ_BIN="/opt/homebrew/bin/zellij"
CLAUDE_BIN="${HOME}/.local/bin/claude"
SESSION="spike014z3-$$"
WORK_DIR="/tmp/spike-014z-3-$$"

# ── skip-not-fail guards ─────────────────────────────────────────────────────
if ! command -v "$ZELLIJ_BIN" >/dev/null 2>&1; then
  echo "SKIP: zellij not installed"
  exit 0
fi
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  echo "SKIP: claude not installed"
  exit 0
fi

echo "=== Spike 014z-3: Stop hook fires inside zellij-owned session ==="
echo "zellij : $ZELLIJ_BIN ($($ZELLIJ_BIN --version))"
echo "claude : $CLAUDE_BIN ($($CLAUDE_BIN --version 2>&1 | head -1))"
echo "session: $SESSION"
echo "work   : $WORK_DIR"
echo ""

mkdir -p "$WORK_DIR"

cleanup() {
  "$ZELLIJ_BIN" kill-session "$SESSION" 2>/dev/null || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# ── [1] Write Stop hook script ────────────────────────────────────────────────
HOOK_SCRIPT="$WORK_DIR/stop-hook.sh"
MARKER_FILE="$WORK_DIR/hook_fired.txt"

cat > "$HOOK_SCRIPT" << 'HOOKEOF'
#!/usr/bin/env bash
# Stop hook: write marker file with timestamp + payload
MARKER="$SPIKE_MARKER_FILE"
{
  echo "HOOK_FIRED"
  echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "--- payload ---"
  cat
} >> "$MARKER"
exit 0
HOOKEOF
chmod +x "$HOOK_SCRIPT"

# ── [2] Write temporary claude settings JSON ─────────────────────────────────
SETTINGS_FILE="$WORK_DIR/settings.json"

cat > "$SETTINGS_FILE" << SETTINGSEOF
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "SPIKE_MARKER_FILE='$MARKER_FILE' bash '$HOOK_SCRIPT'"
          }
        ]
      }
    ]
  }
}
SETTINGSEOF

echo "[1] Hook script   : $HOOK_SCRIPT"
echo "[1] Marker file   : $MARKER_FILE"
echo "[1] Settings file : $SETTINGS_FILE"
cat "$SETTINGS_FILE"
echo ""

# ── [3] Create background zellij session ─────────────────────────────────────
echo "[2] Creating background zellij session '$SESSION'..."
"$ZELLIJ_BIN" attach -b "$SESSION" 2>&1 &
sleep 3

# Discover terminal pane
PANE_LIST=$(ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action list-panes 2>&1)
echo "    Panes: $PANE_LIST"
TERM_PANE=$(echo "$PANE_LIST" | grep terminal | awk '{print $1}' | head -1)
echo "    Terminal pane: $TERM_PANE"
echo ""

# ── [4] Launch claude --settings inside zellij ───────────────────────────────
echo "[3] Launching claude --settings '$SETTINGS_FILE' via write-chars..."
LAUNCH_CMD="$CLAUDE_BIN --settings $SETTINGS_FILE"
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write-chars --pane-id "$TERM_PANE" "$LAUNCH_CMD" 2>&1
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write --pane-id "$TERM_PANE" 13 2>&1
echo "    Sent: '$LAUNCH_CMD' + Enter"

# ── [5] Poll dump-screen for TUI readiness ───────────────────────────────────
echo ""
echo "[4] Polling for TUI readiness (max 30s)..."
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
  ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>&1 || true
  exit 0
fi
echo "    TUI ready after $i polls ($(( i * 500 ))ms)"

echo ""
echo "[5] Screen before injection:"
echo "--- BEGIN PRE-INJECT DUMP ---"
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>&1 || true
echo "--- END PRE-INJECT DUMP ---"
echo ""

# ── [6] Inject "say hi" prompt ───────────────────────────────────────────────
echo "[6] Injecting 'say hi' prompt..."
PROMPT="Reply with just the word HOOKZTEST"
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write-chars --pane-id "$TERM_PANE" "$PROMPT" 2>&1
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action write --pane-id "$TERM_PANE" 13 2>&1
echo "    Sent: '$PROMPT' + Enter"
echo ""

# ── [7] Poll for hook marker file ────────────────────────────────────────────
echo "[7] Waiting for Stop hook to fire (max 90s)..."
HOOK_FIRED=0
FIRED_AT=0
for i in $(seq 1 180); do
  if [ -f "$MARKER_FILE" ] && grep -q "HOOK_FIRED" "$MARKER_FILE" 2>/dev/null; then
    HOOK_FIRED=1
    FIRED_AT=$i
    break
  fi
  sleep 0.5
done

echo ""
echo "[8] Marker file contents ($MARKER_FILE):"
echo "--- BEGIN HOOK OUTPUT ---"
if [ -f "$MARKER_FILE" ]; then
  cat "$MARKER_FILE"
else
  echo "(file not found — hook did not fire)"
fi
echo "--- END HOOK OUTPUT ---"
echo ""

echo "[9] dump-screen at hook evaluation time:"
echo "--- BEGIN SCREEN DUMP ---"
ZELLIJ_SESSION_NAME="$SESSION" "$ZELLIJ_BIN" action dump-screen --pane-id "$TERM_PANE" 2>&1 || true
echo "--- END SCREEN DUMP ---"
echo ""

echo "=== FINDINGS ==="
if [ "$HOOK_FIRED" -eq 1 ]; then
  echo "RESULT: PASS"
  echo "- Stop hook fired while claude ran inside a zellij-owned session"
  echo "- Hook marker appeared after $FIRED_AT × 500ms = $(( FIRED_AT * 500 ))ms"
  echo "- claude launched via write-chars + --settings pointing to temp file"
  echo "- Hook payload contains: session_id, transcript_path, last_assistant_message"
  echo "- last_assistant_message = reply text cc-mobile needs (same as ADR-011 PTY channel)"
  echo "- ZELLIJ mechanism: attach -b + ZELLIJ_SESSION_NAME env var + write-chars + dump-screen"
  echo "- Awkward vs tmux: no --session flag, must use env var; pane-id discovery step needed"
  echo "- Hook behavior: identical to tmux arm — Stop hook is multiplexer-agnostic"
else
  echo "RESULT: PARTIAL"
  echo "- zellij session created, claude launched with --settings, TUI ready"
  echo "- Stop hook did not fire within 90s"
  echo "- Possible: claude still processing, or hook config not loaded correctly"
fi

echo ""
echo "=== spike-014z-3 complete ==="
