/**
 * tui-readiness.ts — TUI readiness detection for ADR-011 hybrid architecture.
 *
 * Pure logic: no node-pty, no SDK, no filesystem I/O.
 * All timing is injected via tick() deltas (no real sleep/setTimeout used internally).
 *
 * Exports:
 *   stripAnsi(s)          — remove ANSI escape sequences from raw PTY output
 *   classify(stripped)    — classify a stripped buffer as "trust" | "ready" | "unknown"
 *   TuiReadinessMachine   — tick-based state machine that emits actions
 */

/**
 * Remove ANSI escape sequences from a raw PTY string.
 *
 * Patterns removed:
 *   - CSI sequences: ESC [ <params> <final>  (covers cursor-movement, color, etc.)
 *   - OSC sequences: ESC ] <any> ST/BEL      (covers window title, hyperlinks, etc.)
 *   - Other ESC sequences: ESC <byte>
 *
 * Cursor-column sequences (e.g. ESC [ 6 G) are removed without inserting spaces,
 * so downstream classifiers must use substring matching, not word splitting.
 */
export function stripAnsi(s: string): string {
  // OSC: ESC ] ... (ST = ESC \ or BEL \x07)
  // Must be removed before CSI to avoid partial matches
  let result = s.replace(/\x1b\][^\x07\x1b]*/g, "");
  // Remove BEL characters left over from OSC termination
  result = result.replace(/\x07/g, "");
  // CSI: ESC [ <params> <final letter>
  result = result.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  // Other ESC sequences: ESC <single byte> (e.g. ESC 7, ESC 8, ESC >)
  result = result.replace(/\x1b[^[\]]/g, "");
  // Strip remaining lone ESC
  result = result.replace(/\x1b/g, "");
  return result;
}

/**
 * Classify a stripped (ANSI-free) text buffer.
 *
 * Returns:
 *   "trust"   — TUI is showing the trust/safety prompt screen
 *   "ready"   — TUI is showing the main ready prompt
 *   "unknown" — not enough signal to classify
 *
 * Token rules (gate-derived):
 *   trust:   buffer contains "safety" OR "project" (NOT "trust" — the confirm echo
 *            "Yes, I trust this folder" also contains "trust" and must NOT classify as trust)
 *   ready:   buffer contains "Claude Code" (with space) OR "╭"
 *   (❯ is deliberately excluded from ready tokens — it appears on both screens)
 *   (trust-as-token is deliberately excluded — see E2 trap above)
 *
 * Priority: trust > ready (trust screen is evaluated first)
 */
export function classify(strippedText: string): "trust" | "ready" | "unknown" {
  if (strippedText.includes("safety") || strippedText.includes("project")) {
    return "trust";
  }
  if (strippedText.includes("Claude Code") || strippedText.includes("╭")) {
    return "ready";
  }
  return "unknown";
}

/**
 * Tick-based TUI readiness state machine.
 *
 * Usage:
 *   const machine = new TuiReadinessMachine({ settleMs: 750, readinessTimeoutMs: 30000 });
 *   // On each PTY data chunk:
 *   machine.feedChunk(rawChunk);
 *   // On each timer tick with elapsed ms since last chunk:
 *   const actions = machine.tick(elapsedMs);
 *   // actions may include: "sendConfirm", "sendPrompt", "timeout"
 *
 * State:
 *   - buffer: accumulated stripped text since last reset
 *   - totalElapsed: cumulative ms from all tick() calls (used for timeout)
 *   - done: set to true after "ready" is emitted (suppresses further actions)
 */
export class TuiReadinessMachine {
  private readonly settleMs: number;
  private readonly readinessTimeoutMs: number;

  private buffer = "";
  private totalElapsed = 0;
  private done = false;

  constructor(opts?: { settleMs?: number; readinessTimeoutMs?: number }) {
    this.settleMs = opts?.settleMs ?? 750;
    this.readinessTimeoutMs = opts?.readinessTimeoutMs ?? 30000;
  }

  /**
   * Feed a raw PTY chunk into the machine.
   * Strips ANSI from rawChunk and accumulates into the current buffer.
   */
  feedChunk(rawChunk: string): void {
    this.buffer += stripAnsi(rawChunk);
  }

  /**
   * Advance the machine by elapsedMsSinceLastChunk milliseconds.
   *
   * Returns an array of actions:
   *   "sendConfirm" — trust screen detected; caller should send \r to confirm
   *   "sendPrompt"  — ready screen detected; caller should send the user prompt
   *   "timeout"     — total elapsed ≥ readinessTimeoutMs and not yet ready
   *   []            — no action yet
   *
   * After emitting "sendConfirm", buffer is reset so the machine can continue
   * watching for the ready screen.
   * After emitting "sendPrompt", done=true and no further actions are emitted.
   * After emitting "timeout", done=true.
   */
  tick(elapsedMsSinceLastChunk: number): Array<"sendConfirm" | "sendPrompt" | "timeout"> {
    if (this.done) return [];

    this.totalElapsed += elapsedMsSinceLastChunk;

    const actions: Array<"sendConfirm" | "sendPrompt" | "timeout"> = [];

    // Check settle threshold
    if (elapsedMsSinceLastChunk >= this.settleMs) {
      const classification = classify(this.buffer);

      if (classification === "trust") {
        // Send confirm and reset buffer to keep watching for ready
        this.buffer = "";
        actions.push("sendConfirm");
        return actions;
      }

      if (classification === "ready") {
        this.done = true;
        actions.push("sendPrompt");
        return actions;
      }

      // unknown — fall through to timeout check
    }

    // Timeout check: cumulative elapsed >= readinessTimeoutMs and not yet ready
    if (this.totalElapsed >= this.readinessTimeoutMs) {
      this.done = true;
      actions.push("timeout");
      return actions;
    }

    return actions;
  }
}
