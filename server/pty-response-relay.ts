/**
 * pty-response-relay.ts — PTY assistant-response bridge for ADR-011 hybrid architecture.
 *
 * Why this exists (ADR-011, verified 2026-06-16 against claude v2.1.177):
 *   PTY-driven interactive `claude --session-id <uuid>` does NOT flush `<uuid>.jsonl`
 *   while the session is alive (nor on `/exit`), so the old "poll getSessionMessages"
 *   readback never resolves. The Stop hook, however, fires at end_turn and its payload
 *   carries `last_assistant_message` (the full reply). This relay bridges that hook
 *   delivery (HTTP) back to the in-flight drive() awaiting the reply.
 *
 * Mirrors pty-permission-relay.ts: a per-session pending Map, injectable timers,
 * resolve-by-id from the HTTP endpoint. Keyed by sessionId (one in-flight drive per
 * session — orchestrator H3 kills any prior handle, and the one-shot drive model uses
 * a fresh session per turn).
 *
 * Hard constraints:
 *   - NO top-level import of node-pty
 *   - NO top-level import of SDK (query, getSessionMessages, etc.)
 *   - Supports injectable setTimeout/clearTimeout for testability
 */

interface PtyResponseRelayOptions {
  timeoutMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
}

interface PendingEntry {
  resolve: (text: string) => void;
  reject: (err: unknown) => void;
  timerId: unknown;
}

/**
 * Creates a PTY response relay that bridges Stop-hook HTTP deliveries to in-flight drives.
 *
 * @param options - Optional config: timeoutMs (default 600000), injectable timers
 */
export function createPtyResponseRelay(options: PtyResponseRelayOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 600000;
  const setTimeoutFn: (fn: () => void, ms: number) => unknown =
    options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn: (id: unknown) => void =
    options.clearTimeoutFn ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  const pending = new Map<string, PendingEntry>();

  /**
   * Await the assistant response for a session.
   * Registers a pending entry synchronously, then returns a Promise that resolves when
   * resolveResponse(sessionId, text) is called, or rejects with "timeout" after timeoutMs.
   *
   * Re-registering the same sessionId rejects any prior waiter with "superseded" first,
   * so a re-drive cannot leak the earlier promise.
   */
  function awaitResponse(sessionId: string): Promise<string> {
    const prior = pending.get(sessionId);
    if (prior) {
      clearTimeoutFn(prior.timerId);
      pending.delete(sessionId);
      prior.reject(new Error("superseded"));
    }

    return new Promise<string>((resolve, reject) => {
      const timerId = setTimeoutFn(() => {
        pending.delete(sessionId);
        reject(new Error("timeout"));
      }, timeoutMs);

      pending.set(sessionId, { resolve, reject, timerId });
    });
  }

  /**
   * Resolve a pending response delivery. Idempotent: unknown sessionIds are a no-op.
   * @returns true if a waiter was resolved, false if no pending entry existed.
   */
  function resolveResponse(sessionId: string, text: string): boolean {
    const entry = pending.get(sessionId);
    if (!entry) {
      return false;
    }
    clearTimeoutFn(entry.timerId);
    pending.delete(sessionId);
    entry.resolve(text);
    return true;
  }

  /**
   * Returns true iff a response waiter is pending for the given session.
   */
  function hasPending(sessionId: string): boolean {
    return pending.has(sessionId);
  }

  /**
   * Returns the number of unresolved pending response waiters.
   */
  function getPendingCount(): number {
    return pending.size;
  }

  /**
   * Cancel a pending response waiter for the session.
   * First calls the injected clearTimeout, then rejects the pending promise with Error("cancelled"),
   * then removes the entry. No-op (no throw) if no such waiter.
   */
  function cancel(sessionId: string): void {
    const entry = pending.get(sessionId);
    if (!entry) {
      return;
    }
    clearTimeoutFn(entry.timerId);
    entry.reject(new Error("cancelled"));
    pending.delete(sessionId);
  }

  return {
    awaitResponse,
    resolveResponse,
    hasPending,
    getPendingCount,
    cancel,
  };
}

export type PtyResponseRelay = ReturnType<typeof createPtyResponseRelay>;
