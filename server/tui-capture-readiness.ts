/**
 * tui-capture-readiness.ts
 *
 * C-hybrid interactive-readiness detector.
 *
 * Polls tmux capture-pane -t <session> -p for frames.
 * Reuses pure classify() + stripAnsi() from tui-readiness.
 *
 * Discriminates welcome banner (classify-ready but mutating) from true-ready
 * via STABLE_COUNT consecutive identical frames that classify as ready.
 *
 * Pure logic + injectable capture for testability. No TuiReadinessMachine.
 */

import { classify, stripAnsi } from "./tui-readiness";

export function perFrameReady(frame: string): boolean {
  if (typeof frame !== "string" || frame.length === 0) {
    return false;
  }
  const stripped = stripAnsi(frame);
  return classify(stripped) === "ready";
}

export function settleDecision(
  frames: string[],
  stableCount = 3,
): { ready: boolean; readyAtIndex: number | null } {
  if (!Array.isArray(frames) || frames.length === 0 || stableCount < 1) {
    return { ready: false, readyAtIndex: null };
  }

  let prev: string | null = null;
  let count = 0;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const isReady = perFrameReady(f);
    if (isReady && f === prev) {
      count++;
      if (count >= stableCount) {
        return { ready: true, readyAtIndex: i };
      }
    } else {
      count = isReady ? 1 : 0;
    }
    prev = f;
  }

  return { ready: false, readyAtIndex: null };
}

const DEFAULT_POLL_INTERVAL_MS = 800; // >= 750ms per spec
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_STABLE_COUNT = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function settleLoop(opts: {
  capture: () => Promise<string | null>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  stableCount?: number;
}): Promise<{ ready: boolean; reason: "stable" | "timeout" | "session_gone" }> {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stableCount = opts.stableCount ?? DEFAULT_STABLE_COUNT;

  const startTime = Date.now();
  let prev: string | null = null;
  let count = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startTime >= timeoutMs) {
      return { ready: false, reason: "timeout" };
    }

    let frame: string | null;
    try {
      frame = await opts.capture();
    } catch {
      // treat capture error as session gone (defensive)
      return { ready: false, reason: "session_gone" };
    }

    if (frame === null) {
      return { ready: false, reason: "session_gone" };
    }

    const isReady = perFrameReady(frame);
    if (isReady && frame === prev) {
      count++;
      if (count >= stableCount) {
        return { ready: true, reason: "stable" };
      }
    } else {
      count = isReady ? 1 : 0;
    }
    prev = frame;

    // check time again before sleeping to avoid oversleep past timeout
    if (Date.now() - startTime >= timeoutMs) {
      return { ready: false, reason: "timeout" };
    }

    await sleep(pollIntervalMs);
  }
}
