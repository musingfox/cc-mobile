#!/usr/bin/env bun
/**
 * pty-stop-hook.ts — Claude Stop hook for the PTY assistant-response readback (ADR-011).
 *
 * Why: PTY-driven interactive claude (v2.1.177) does not flush its JSONL transcript while
 * alive, so the server cannot poll getSessionMessages for the reply. The Stop hook fires at
 * end_turn with `last_assistant_message` in its payload — this script relays that text to the
 * server, which resolves the in-flight drive() and pushes the reply to the phone.
 *
 * Reads JSON from stdin: { session_id, last_assistant_message, transcript_path, ... }
 * POSTs { session_id, text } to CC_MOBILE_RESPONSE_URL
 *   (default: http://localhost:3001/api/pty-response)
 *
 * Stop hooks must NOT block the turn: this writes nothing to stdout and always exits 0.
 * All diagnostics go to stderr.
 *
 * Hard constraints:
 *   - NO top-level import of node-pty
 *   - NO top-level import of SDK
 *   - Never throw to the parent claude process
 */

const RESPONSE_URL = process.env.CC_MOBILE_RESPONSE_URL ?? "http://localhost:3001/api/pty-response";

// Short timeout: the POST is fire-and-forget; the server resolves the waiter itself.
const HTTP_TIMEOUT_MS = 10000;

async function main(): Promise<void> {
  const stdinText = await new Response(Bun.stdin.stream()).text();

  let payload: { session_id?: string; last_assistant_message?: string };
  try {
    payload = JSON.parse(stdinText.trim());
  } catch (err) {
    process.stderr.write(`[pty-stop-hook] Failed to parse stdin JSON: ${err}\n`);
    return; // exit 0 — never block the turn
  }

  const sessionId = payload.session_id;
  const text = payload.last_assistant_message ?? "";

  if (!sessionId) {
    process.stderr.write(`[pty-stop-hook] Missing session_id; nothing to relay.\n`);
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(RESPONSE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        process.stderr.write(`[pty-stop-hook] Server returned ${response.status}\n`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[pty-stop-hook] Request failed: ${errMsg}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[pty-stop-hook] Fatal: ${err}\n`);
  // exit 0 implicitly — Stop hook must never crash the parent
});

// Make this file a module (own scope) so its top-level `main`/consts don't collide
// with the sibling hook script pty-permission-hook.ts under tsc's global-script scoping.
export {};
