/**
 * pty-reader.ts — JSONL session reader for ADR-011 hybrid architecture.
 *
 * Hard constraints:
 *   - NO top-level import of SDK getSessionMessages (dynamic import only, in real-fs branch)
 *   - NO top-level import of session-history.ts (same reason: it has a top-level SDK import)
 *   - NO top-level import of node-pty
 *   - Real filesystem path uses dynamic import() to avoid pulling SDK into top-level graph
 *
 * Injection seams:
 *   - loadSessionHistory: accepts options.sessionStore for in-memory/test injection
 *   - readLatestAssistantResponse: accepts options.getMessagesFn for poll injection
 *   - runPtySession: accepts options.spawner + options.getMessagesFn for full mock
 */

import type { SpawnerFn } from "./pty-driver";
import { defaultSpawner } from "./pty-driver";
import { TuiReadinessMachine } from "./tui-readiness";

// ── Types ──────────────────────────────────────────────────────────────────

/** Minimal history entry shape returned by loadSessionHistory. */
export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

/** Injected in-memory store (test seam for loadSessionHistory). */
export interface SessionStore {
  load(key: string): unknown[];
}

/** Injected poll function (test seam for readLatestAssistantResponse). */
export type GetMessagesFn = (sessionId: string) => Promise<unknown[]>;

/** Options for loadSessionHistory. */
export interface LoadSessionHistoryOptions {
  /** If provided, use this store instead of the real filesystem. */
  sessionStore?: SessionStore;
}

/** Options for readLatestAssistantResponse. */
export interface ReadLatestOptions {
  /** Injected poll function. If omitted, dynamic-imports getSessionMessages. */
  getMessagesFn?: GetMessagesFn;
  /** Poll timeout in ms. Default: 60000. */
  timeout?: number;
  /** Poll interval in ms. Default: 500. */
  interval?: number;
  /**
   * Number of end_turn assistant messages already present before this turn.
   * Only accept a new end_turn that pushes the count beyond this baseline.
   * Default: 0 (accept any end_turn — legacy behavior).
   */
  baselineEndTurnCount?: number;
  /**
   * Optional predicate: returns true while a permission for this session is
   * pending (PreToolUse hook blocking). On any poll tick where it returns true,
   * the deadline baseline is reset so the full `timeout` window restarts once
   * pending clears. Omitted ⇒ pure legacy 60s behavior.
   */
  isPermissionPending?: () => boolean;
  /** Injectable clock seam (test): wall-clock reader. Default: Date.now. */
  nowFn?: () => number;
  /** Injectable clock seam (test): timer scheduler. Default: setTimeout. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  /** Injectable clock seam (test): timer canceller. Default: clearTimeout. */
  clearTimeoutFn?: (id: unknown) => void;
}

/** Options for runPtySession. */
export interface RunPtySessionOptions {
  /** Injected spawner (for testing without real PTY). */
  spawner?: SpawnerFn;
  /** Injected poll function. */
  getMessagesFn?: GetMessagesFn;
  /**
   * Called synchronously with the process handle immediately after driveOnce,
   * before any await/poll. Caller may use this to register kill/exited for teardown.
   */
  onHandle?: (h: { kill: () => void; exited: Promise<number> }) => void;
  /** Poll timeout in ms. Default: 60000. */
  timeout?: number;
  /** Poll interval in ms. Default: 500. */
  interval?: number;
  /** Optional predicate: freeze the poll deadline while a permission is pending. */
  isPermissionPending?: () => boolean;
  /** Injectable clock seam (test): wall-clock reader. Default: Date.now. */
  nowFn?: () => number;
  /** Injectable clock seam (test): timer scheduler. Default: setTimeout. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  /** Injectable clock seam (test): timer canceller. Default: clearTimeout. */
  clearTimeoutFn?: (id: unknown) => void;
  /**
   * ADR-011 readback seam. When provided, runPtySession uses this to obtain the
   * assistant reply INSTEAD of polling getSessionMessages — registered before the
   * prompt is sent, resolved by the Stop-hook relay. This is the live path for
   * claude v2.1.177 (which does not flush JSONL while alive). When omitted, the
   * legacy getSessionMessages poll path is used (preserved for tests/fallback).
   */
  awaitResponseFn?: (sessionId: string) => Promise<string>;
}

// ── Pure helpers (no SDK, no pty) ─────────────────────────────────────────

/**
 * Returns true if an assistant message's content is tool_use only
 * (possibly mixed with thinking blocks, but no text output).
 */
function isToolUseOnly(message: unknown): boolean {
  if (typeof message !== "object" || message === null) return false;
  const obj = message as Record<string, unknown>;
  if (!Array.isArray(obj.content) || obj.content.length === 0) return false;
  return (obj.content as { type: string }[]).every(
    (block) => block.type === "tool_use" || block.type === "thinking",
  );
}

/**
 * Extract text string from a message object.
 * Handles string content and content arrays with text blocks.
 */
function extractText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const obj = message as Record<string, unknown>;
  const content = obj.content;

  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    return (content as { type: string; text?: string }[])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
  }

  return "";
}

/**
 * Check whether a raw SDK message is an end_turn assistant with text content.
 */
function isEndTurnAssistant(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (obj.type !== "assistant") return false;

  const msg = obj.message as Record<string, unknown> | undefined;
  if (!msg) return false;

  if (msg.stop_reason !== "end_turn") return false;
  if (isToolUseOnly(msg)) return false;

  const text = extractText(msg);
  return text.length > 0;
}

/**
 * Extract the text from an end_turn assistant message.
 * Caller is responsible for calling isEndTurnAssistant first.
 */
function extractEndTurnText(raw: unknown): string {
  const obj = raw as Record<string, unknown>;
  const msg = obj.message as Record<string, unknown>;
  return extractText(msg);
}

/**
 * Convert raw SDK messages array into HistoryEntry[].
 * Filters: skip tool_result users, skip tool_use-only assistants.
 * Returns exactly {role, content} — no id/timestamp.
 */
function rawMessagesToHistory(messages: unknown[]): HistoryEntry[] {
  const result: HistoryEntry[] = [];

  for (const raw of messages) {
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;

    if (obj.type === "user") {
      const msg = obj.message as Record<string, unknown> | undefined;
      if (!msg) continue;

      // Skip tool_result messages
      if (Array.isArray(msg.content)) {
        const hasToolResult = (msg.content as { type: string }[]).some(
          (b) => b.type === "tool_result",
        );
        if (hasToolResult) continue;
      }

      const text = extractText(msg);
      if (text) {
        result.push({ role: "user", content: text });
      }
    } else if (obj.type === "assistant") {
      const msg = obj.message as Record<string, unknown> | undefined;
      if (!msg) continue;

      // Only include end_turn text assistants
      if (msg.stop_reason !== "end_turn") continue;
      if (isToolUseOnly(msg)) continue;

      const text = extractText(msg);
      if (text) {
        result.push({ role: "assistant", content: text });
      }
    }
  }

  return result;
}

// ── driveReadiness ────────────────────────────────────────────────────────────

/**
 * Drive a PTY process through the TUI readiness handshake before sending a prompt.
 *
 * Semantics (debounce pattern):
 *   - Seeds one overall timeout at entry (readinessTimeoutMs). Rejects with string "timeout"
 *     if readiness is never reached in time.
 *   - Registers proc.onData: each chunk feeds machine.feedChunk + clears+re-arms settle timer.
 *   - When the settle timer fires, calls machine.tick(settleMs):
 *       sendConfirm → proc.write("\r") (machine has already reset its buffer)
 *       sendPrompt  → proc.write(prompt+"\r") then resolve
 *       timeout     → reject string "timeout"
 *   - On resolve or reject: both timers are cleared; settled guard prevents further action.
 *
 * @param proc   - PTY process handle with onData + write
 * @param prompt - Prompt text to send when TUI is ready
 * @param opts   - Timing config + optional injectable timer functions
 */
export function driveReadiness(
  proc: { onData: (cb: (chunk: string) => void) => void; write: (data: string) => void },
  prompt: string,
  opts: {
    settleMs: number;
    readinessTimeoutMs: number;
    setTimeoutFn?: (fn: () => void, ms: number) => unknown;
    clearTimeoutFn?: (id: unknown) => void;
  },
): Promise<void> {
  const setT = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutFn ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let debounce: unknown;

    const machine = new TuiReadinessMachine({
      settleMs: opts.settleMs,
      readinessTimeoutMs: opts.readinessTimeoutMs,
    });

    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      clearT(debounce);
      clearT(overall);
      if (err !== undefined) reject(err);
      else resolve();
    };

    // Seed overall timeout once at entry
    const overall = setT(() => {
      finish("timeout");
    }, opts.readinessTimeoutMs);

    const onSettle = () => {
      if (settled) return;
      const actions = machine.tick(opts.settleMs);
      for (const action of actions) {
        if (action === "sendConfirm") {
          proc.write("\r");
          // machine has already reset its buffer; no re-arm here — onData does that
          return;
        } else if (action === "sendPrompt") {
          proc.write(prompt + "\r");
          finish();
          return;
        } else if (action === "timeout") {
          finish("timeout");
          return;
        }
      }
      // actions === [] means classify returned "unknown" — re-arm the settle timer
      // directly WITHOUT clearing the just-fired timer (gate E-H2-1 timer-count semantics).
      debounce = setT(onSettle, opts.settleMs);
    };

    proc.onData((chunk: string) => {
      if (settled) return;
      machine.feedChunk(chunk);
      clearT(debounce);
      debounce = setT(onSettle, opts.settleMs);
    });
  });
}

// ── Exported functions ─────────────────────────────────────────────────────

/**
 * Load conversation history for a session.
 *
 * With options.sessionStore: reads from in-memory store (test/injection path).
 * Without: dynamically imports getSessionMessages from the SDK (real-fs path).
 *
 * Returns HistoryEntry[] with shape {role, content} — exactly that, no extras.
 * Last entry is the final end_turn assistant message (if any).
 * tool_use-only assistant messages are filtered out.
 */
export async function loadSessionHistory(
  sessionId: string,
  options?: LoadSessionHistoryOptions,
): Promise<HistoryEntry[]> {
  let rawMessages: unknown[];

  if (options?.sessionStore) {
    // Injected in-memory path (test seam)
    rawMessages = options.sessionStore.load(sessionId);
  } else {
    // Real filesystem path: dynamic import to avoid top-level SDK dependency
    const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
    rawMessages = await getSessionMessages(sessionId);
  }

  return rawMessagesToHistory(rawMessages);
}

/**
 * Poll until the session has an end_turn assistant message newer than afterUserUuid.
 *
 * Resolves with the assistant text when found.
 * Rejects with the string "timeout" (not an Error) after options.timeout ms.
 *
 * Polling strategy: poll immediately, then every interval ms.
 *
 * @param sessionId      - SDK session ID to poll
 * @param afterUserUuid  - UUID of the user message that triggered this response
 *                         (falsy = accept any end_turn assistant in the array)
 * @param options        - { getMessagesFn, timeout, interval }
 */
export async function readLatestAssistantResponse(
  sessionId: string,
  afterUserUuid: string | undefined | null,
  options: ReadLatestOptions,
): Promise<string> {
  const timeout = options.timeout ?? 60000;
  const interval = options.interval ?? 500;

  // Real-fs poll function (dynamic import, only if not injected)
  let pollFn: GetMessagesFn;
  if (options.getMessagesFn) {
    pollFn = options.getMessagesFn;
  } else {
    // Dynamic import to avoid top-level SDK dependency
    const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
    pollFn = (id: string) => getSessionMessages(id) as Promise<unknown[]>;
  }

  const baselineEndTurnCount = options.baselineEndTurnCount ?? 0;

  // Clock seam (OWD-1): a single virtual clock backs BOTH the backstop timer and
  // the elapsed Date.now() checks. Defaults are the real wall-clock + timers.
  const nowFn = options.nowFn ?? Date.now;
  const setT: (fn: () => void, ms: number) => unknown =
    options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT: (id: unknown) => void =
    options.clearTimeoutFn ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const isPermissionPending = options.isPermissionPending;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let pollTimer: unknown;

    // H-E fix: independent top-level timer so a never-settling pollFn still times out.
    // This fires regardless of whether poll() is suspended inside an awaited pollFn call.
    const armBackstop = (): unknown =>
      setT(() => {
        if (!settled) {
          settled = true;
          clearT(pollTimer);
          reject("timeout");
        }
      }, timeout);

    // `start` and `timeoutHandle` are mutable: a pending tick resets the baseline
    // (D3) by moving `start` to now AND re-arming the backstop together.
    let start = nowFn();
    let timeoutHandle = armBackstop();

    const poll = async () => {
      if (settled) return;

      // D3: while a permission is pending, reset the deadline baseline so the full
      // `timeout` window restarts once pending clears. Move `start`, kill the stale
      // backstop, and re-arm it — all three move together (else the old backstop
      // mis-fires or the elapsed check trips). Skip the elapsed check + pollFn this
      // tick; reset ONLY on pending=true (the post-flip window is carried by the
      // backstop armed during the last pending tick).
      if (isPermissionPending?.()) {
        start = nowFn();
        clearT(timeoutHandle);
        timeoutHandle = armBackstop();
        pollTimer = setT(poll, interval);
        return;
      }

      // Check elapsed time before calling pollFn
      if (nowFn() - start >= timeout) {
        if (!settled) {
          settled = true;
          clearT(timeoutHandle);
          clearT(pollTimer);
          reject("timeout");
        }
        return;
      }

      // H2 fix: wrap pollFn in try/catch so throws propagate as rejections
      let messages: unknown[];
      try {
        messages = await pollFn(sessionId);
      } catch (err) {
        if (!settled) {
          settled = true;
          clearT(timeoutHandle);
          clearT(pollTimer);
          reject(err);
        }
        return;
      }

      if (settled) return;

      // H3 fix: count end_turn messages, resolve only when count exceeds baseline
      // If afterUserUuid provided: look for assistant messages that appear after it in the array
      let foundAfter = !afterUserUuid; // if no uuid filter, accept from the start
      let endTurnsSeen = 0;
      for (const raw of messages) {
        if (!foundAfter) {
          const obj = raw as Record<string, unknown>;
          if (obj.uuid === afterUserUuid) {
            foundAfter = true;
          }
          continue;
        }
        if (isEndTurnAssistant(raw)) {
          endTurnsSeen++;
          if (endTurnsSeen > baselineEndTurnCount) {
            settled = true;
            clearT(timeoutHandle);
            clearT(pollTimer);
            resolve(extractEndTurnText(raw));
            return;
          }
        }
      }

      // Not found yet — check timeout again then schedule next poll
      if (nowFn() - start >= timeout) {
        if (!settled) {
          settled = true;
          clearT(timeoutHandle);
          clearT(pollTimer);
          reject("timeout");
        }
        return;
      }

      pollTimer = setT(poll, interval);
    };

    // Start polling immediately (no leading delay)
    poll();
  });
}

/**
 * End-to-end: drive a prompt into an interactive claude session via PTY,
 * then poll JSONL until an end_turn assistant response appears.
 *
 * Write-before-poll order is guaranteed: driveOnce completes (synchronously)
 * before readLatestAssistantResponse starts polling.
 *
 * @param sessionId - SDK session ID
 * @param cwd       - Working directory for the spawned process
 * @param prompt    - Human prompt to send
 * @param options   - { spawner, getMessagesFn, timeout, interval }
 * @returns The assistant's reply text
 */
export async function runPtySession(
  sessionId: string,
  cwd: string,
  prompt: string,
  options?: RunPtySessionOptions,
): Promise<string> {
  // Resolve the poll function once so we can reuse it for baseline + poll
  let pollFn: GetMessagesFn;
  if (options?.getMessagesFn) {
    pollFn = options.getMessagesFn;
  } else {
    // Dynamic import to avoid top-level SDK dependency
    const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
    pollFn = (id: string) => getSessionMessages(id) as Promise<unknown[]>;
  }

  // Spawn the process handle directly (without writing yet — readiness path defers the write).
  // We call the spawner directly rather than via PtyDriver.driveOnce so we can inspect onData
  // before deciding when to write the prompt.
  const effectiveSpawner: SpawnerFn = options?.spawner ?? defaultSpawner;
  const args = ["claude", "--session-id", sessionId];
  const proc = effectiveSpawner(args, cwd);

  const handle = {
    kill: proc.kill ?? (() => {}),
    exited: proc.exited ?? Promise.resolve(0),
  };

  // H-C-2 fix: expose handle to caller synchronously, before any await/poll
  options?.onHandle?.(handle);

  // ADR-011 readback seam: register the response waiter BEFORE the prompt is sent,
  // so a fast Stop-hook delivery cannot race ahead of our listener.
  const responsePromise = options?.awaitResponseFn?.(sessionId);

  try {
    if (proc.onData) {
      // ── Readiness-aware path ──────────────────────────────────────────────────
      // onData is present: use driveReadiness (debounce-based) to detect trust/ready
      // screens before sending the prompt.
      await driveReadiness(
        proc as { onData: (cb: (chunk: string) => void) => void; write: (data: string) => void },
        prompt,
        { settleMs: 750, readinessTimeoutMs: 30000 },
      );
    } else {
      // ── Legacy path (no onData) ───────────────────────────────────────────────
      // Spawner is a legacy mock (e.g. orchestrator tests) that does not expose
      // onData. Preserve old behavior: write prompt immediately (blind injection).
      proc.write(`${prompt}\r`);
    }
  } catch (err) {
    // Readiness failed → the prompt was never delivered, so no Stop hook will fire.
    // Swallow the orphaned response waiter's eventual timeout rejection (it self-cleans
    // from the relay map) and fail fast with the readiness error instead of hanging.
    responsePromise?.catch(() => {});
    throw err;
  }

  // ADR-011 readback: if a response waiter was registered, the reply arrives via the
  // Stop-hook relay — await it directly and skip the JSONL poll (which never resolves
  // for live PTY sessions on claude v2.1.177).
  if (responsePromise !== undefined) {
    return await responsePromise;
  }

  // 2. Count baseline end_turn messages (H3 fix: ignore pre-existing responses)
  let baselineEndTurnCount = 0;
  try {
    const baselineMessages = await pollFn(sessionId);
    for (const raw of baselineMessages) {
      if (isEndTurnAssistant(raw)) {
        baselineEndTurnCount++;
      }
    }
  } catch {
    // If baseline poll fails, proceed with 0 baseline (best-effort)
    baselineEndTurnCount = 0;
  }

  // 3. Poll: wait for a new end_turn response beyond the baseline
  return readLatestAssistantResponse(sessionId, undefined, {
    getMessagesFn: pollFn,
    timeout: options?.timeout,
    interval: options?.interval,
    baselineEndTurnCount,
    isPermissionPending: options?.isPermissionPending,
    nowFn: options?.nowFn,
    setTimeoutFn: options?.setTimeoutFn,
    clearTimeoutFn: options?.clearTimeoutFn,
  });
}
