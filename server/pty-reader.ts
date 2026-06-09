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
import { PtyDriver } from "./pty-driver";

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
}

/** Options for runPtySession. */
export interface RunPtySessionOptions {
  /** Injected spawner (for testing without real PTY). */
  spawner?: SpawnerFn;
  /** Injected poll function. */
  getMessagesFn?: GetMessagesFn;
  /** Poll timeout in ms. Default: 60000. */
  timeout?: number;
  /** Poll interval in ms. Default: 500. */
  interval?: number;
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

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    // H-E fix: independent top-level timer so a never-settling pollFn still times out.
    // This fires regardless of whether poll() is suspended inside an awaited pollFn call.
    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject("timeout");
      }
    }, timeout);

    const start = Date.now();

    const poll = async () => {
      if (settled) return;

      // Check elapsed time before calling pollFn
      if (Date.now() - start >= timeout) {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
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
          clearTimeout(timeoutHandle);
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
            clearTimeout(timeoutHandle);
            resolve(extractEndTurnText(raw));
            return;
          }
        }
      }

      // Not found yet — check timeout again then schedule next poll
      if (Date.now() - start >= timeout) {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          reject("timeout");
        }
        return;
      }

      setTimeout(poll, interval);
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

  // 1. Drive: synchronous PTY injection (write-before-poll — preserves ordering contract)
  const driver = new PtyDriver(options?.spawner);
  driver.driveOnce(sessionId, cwd, prompt);

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
  });
}
