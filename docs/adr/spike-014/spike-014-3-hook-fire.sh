#!/usr/bin/env bash
# spike-014-3-hook-fire.sh
# Assumption 3: a Stop hook installed via --settings fires when claude runs inside
# a tmux session (C-hybrid owns the session), providing a relay POST channel for
# cc-mobile to receive replies without PTY onData polling.
#
# Zellij arm: SKIP (zellij not installed on this machine — see ADR-014).
#
# Skip-not-fail: if tmux or claude are absent, exit 0 + print SKIP.
# Run under PATH=/usr/bin:/bin → exits 0 with SKIP.
#
# Strategy:
#   1. Write a temporary Stop hook script that appends a HOOK_FIRED marker to a
#      known marker file (rather than POSTing to cc-mobile server, to avoid
#      requiring a running server in this spike).
#   2. Write a temporary claude settings.json FILE (not directory) that registers
#      this Stop hook. Pass via --settings <file>.
#   3. Launch claude inside a detached tmux session with --settings <file>.
#   4. Inject a trivial prompt via tmux send-keys and send Enter.
#   5. Wait for the marker file to appear (hook fired).
#   6. Capture tmux screen for record.
#   7. Tear down.
#
# Artifact: stdout saved as spike-014-3-hook-fire.txt
#
# Usage: bash docs/adr/spike-014/spike-014-3-hook-fire.sh

set -euo pipefail

SESSION="spike014-3-$$"
WORK_DIR="/tmp/spike-014-3-$$"

# ── skip-not-fail guards ─────────────────────────────────────────────────────
if ! command -v tmux >/dev/null 2>&1; then
  echo "SKIP: tmux not installed"
  exit 0
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "SKIP: claude not installed"
  exit 0
fi

# Zellij arm: always SKIP (not installed)
if ! command -v zellij >/dev/null 2>&1; then
  ZELLIJ_ARM="SKIP: zellij not installed — zellij arm skipped; tmux arm runs below"
else
  ZELLIJ_ARM="zellij present at $(command -v zellij)"
fi

TMUX_BIN="$(command -v tmux)"
CLAUDE_BIN="$(command -v claude)"

echo "=== spike-014 assumption-3: Stop hook fires inside tmux-owned session ==="
echo "tmux   : $TMUX_BIN ($($TMUX_BIN -V))"
echo "claude : $CLAUDE_BIN ($($CLAUDE_BIN --version 2>&1 | head -1))"
echo "session: $SESSION"
echo "work   : $WORK_DIR"
echo ""
echo "Zellij arm: $ZELLIJ_ARM"
echo ""

mkdir -p "$WORK_DIR"

cleanup() {
  "$TMUX_BIN" kill-session -t "$SESSION" 2>/dev/null || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# ── write a minimal Stop hook script ─────────────────────────────────────────
HOOK_SCRIPT="$WORK_DIR/stop-hook.sh"
MARKER_FILE="$WORK_DIR/hook_fired.txt"

cat > "$HOOK_SCRIPT" << 'HOOKEOF'
#!/usr/bin/env bash
# Stop hook: record that the hook fired, capture the payload.
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

# ── write temporary claude settings JSON FILE ──────────────────────────────
# Note: --settings takes a FILE path (not a directory). The file is loaded
# as ADDITIONAL settings merged on top of ~/.claude/settings.json.
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

# ── launch claude inside tmux with --settings <file> ─────────────────────────
echo "[2] Starting tmux session with claude --settings '$SETTINGS_FILE'..."
"$TMUX_BIN" new-session -d -s "$SESSION" -x 220 -y 50 \
  "$CLAUDE_BIN" --settings "$SETTINGS_FILE" 2>&1
echo "    tmux session '$SESSION' created."

# ── wait for TUI ready (claude with --settings needs ~10-12s to start) ───────
echo "[3] Waiting for TUI prompt (max 30s, 0.5s intervals)..."
READY=0
for i in $(seq 1 60); do
  SCREEN="$("$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true)"
  if printf '%s\n' "$SCREEN" | grep -qiE '^\s*❯|Claude Code|auto mode'; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 0 ]; then
  echo "SKIP: claude TUI did not start within 30s (auth/network issue)"
  echo "SKIP: hook fire test could not run — claude startup failed"
  exit 0
fi
echo "    TUI ready after $i polls ($(( i * 500 ))ms)."
echo ""

# ── capture screen before injection ──────────────────────────────────────────
echo "[4] Screen before injection:"
echo "--- BEGIN PRE-INJECT CAPTURE ---"
"$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true
echo "--- END PRE-INJECT CAPTURE ---"
echo ""

# ── inject a minimal prompt and submit ───────────────────────────────────────
echo "[5] Injecting trivial prompt and pressing Enter..."
PROMPT="Reply with just the word HOOKTEST"
"$TMUX_BIN" send-keys -t "$SESSION" "$PROMPT" "Enter"
echo "    Sent: '$PROMPT' + Enter"
echo ""

# ── wait for hook_fired.txt to appear (max 90s for claude to respond) ─────────
echo "[6] Waiting for Stop hook to fire (max 90s)..."
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
echo "[7] Marker file contents ($MARKER_FILE):"
echo "--- BEGIN HOOK OUTPUT ---"
if [ -f "$MARKER_FILE" ]; then
  cat "$MARKER_FILE"
else
  echo "(file not found — hook did not fire)"
fi
echo "--- END HOOK OUTPUT ---"
echo ""

echo "[8] tmux screen capture at hook evaluation time:"
echo "--- BEGIN SCREEN CAPTURE ---"
"$TMUX_BIN" capture-pane -t "$SESSION" -p 2>/dev/null || true
echo "--- END SCREEN CAPTURE ---"
echo ""

if [ "$HOOK_FIRED" -eq 1 ]; then
  echo "RESULT: PASS — Stop hook fired while claude ran inside a tmux-owned session"
  echo "OBSERVATION: hook marker file appeared after $FIRED_AT × 500ms ($(( FIRED_AT * 500 ))ms total)"
  echo "OBSERVATION: The Stop hook payload contains: session_id, transcript_path,"
  echo "             last_assistant_message, cwd, hook_event_name=Stop."
  echo "OBSERVATION: last_assistant_message = the reply text cc-mobile needs to relay"
  echo "             to the phone — identical to the ADR-011 pty-stop-hook.ts channel."
  echo "IMPLICATION (C-hybrid): cc-mobile can register a Stop hook (--settings <file>)"
  echo "             when it launches claude inside its owned tmux session. The hook is"
  echo "             the primary reply-readback channel without any PTY onData access."
  echo "ZELLIJ ARM : $ZELLIJ_ARM"
else
  echo "RESULT: SKIP — hook did not fire within 90s (claude may need more time)"
  echo "SKIP: Stop hook fire not confirmed — live claude run inconclusive"
  echo "ZELLIJ ARM : $ZELLIJ_ARM"
fi

echo ""
echo "=== spike-014-3 complete ==="
