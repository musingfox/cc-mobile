/**
 * pty-permission-relay.ts — PTY permission bridge for ADR-011 hybrid architecture.
 *
 * Hard constraints:
 *   - NO top-level import of node-pty
 *   - NO top-level import of SDK (query, getSessionMessages, etc.)
 *   - Supports injectable setTimeout/clearTimeout for testability
 */

export type PtyRelaySendFn = (
  sessionId: string,
  requestId: string,
  tool: { name: string; parameters: Record<string, unknown> },
) => void;

export type PtyRelaySnapshot = {
  toolUseId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  elapsedMs: number;
};

interface PtyPermissionRelayOptions {
  timeoutMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
}

interface PendingEntry {
  resolve: (result: { allow: boolean; answers?: Record<string, string> }) => void;
  timerId: unknown;
  createdAt: number;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/**
 * Creates a PTY permission relay that bridges HTTP hook requests to WebSocket clients.
 *
 * @param sendToClient - Called to push a permission_request to the client for a given session
 * @param options - Optional config: timeoutMs, injectable setTimeout/clearTimeout
 */
export function createPtyPermissionRelay(
  sendToClient: PtyRelaySendFn,
  options: PtyPermissionRelayOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 600000;
  const setTimeoutFn: (fn: () => void, ms: number) => unknown =
    options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn: (id: unknown) => void =
    options.clearTimeoutFn ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  const pending = new Map<string, PendingEntry>();

  /**
   * Request permission for a PTY tool use.
   * Calls sendToClient synchronously, then returns a Promise that resolves when
   * resolvePermission is called (or when the timeout fires).
   */
  function requestPtyPermission(params: {
    sessionId: string;
    toolUseId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
  }): Promise<{ allow: boolean; answers?: Record<string, string> }> {
    const { sessionId, toolUseId, toolName, toolInput } = params;

    return new Promise((resolve) => {
      const timerId = setTimeoutFn(() => {
        // Timeout: deny and remove from map
        pending.delete(toolUseId);
        resolve({ allow: false });
      }, timeoutMs);

      pending.set(toolUseId, {
        resolve,
        timerId,
        createdAt: Date.now(),
        sessionId,
        toolName,
        toolInput,
      });

      // Call sendToClient synchronously so EX-9 tick-test sees it immediately
      sendToClient(sessionId, toolUseId, { name: toolName, parameters: toolInput });
    });
  }

  /**
   * Resolve a pending permission request. Idempotent: unknown ids are silently ignored.
   */
  function resolvePermission(
    toolUseId: string,
    allow: boolean,
    answers?: Record<string, string>,
  ): void {
    const entry = pending.get(toolUseId);
    if (!entry) {
      // Unknown id — safe no-op (could be SDK relay resolving an unknown pty id)
      return;
    }

    clearTimeoutFn(entry.timerId);
    pending.delete(toolUseId);
    entry.resolve({ allow, answers });
  }

  /**
   * Returns the number of unresolved pending requests.
   */
  function getPendingCount(): number {
    return pending.size;
  }

  /**
   * Pause all pending permission requests (e.g. on WebSocket disconnect).
   * Clears each timer but does NOT resolve the promise and does NOT delete from map.
   * Returns snapshots that can be passed to resumePending on reconnect.
   */
  function pausePending(): PtyRelaySnapshot[] {
    const snapshots: PtyRelaySnapshot[] = [];
    for (const [toolUseId, entry] of pending) {
      snapshots.push({
        toolUseId,
        sessionId: entry.sessionId,
        toolName: entry.toolName,
        toolInput: entry.toolInput,
        elapsedMs: Date.now() - entry.createdAt,
      });
      clearTimeoutFn(entry.timerId);
    }
    return snapshots;
  }

  /**
   * Resume previously paused permission requests (e.g. on WebSocket reconnect).
   * For each snapshot:
   *   - If no pending entry found → skip (already resolved or unknown).
   *   - If remainingMs <= 0 → expired deny: delete map entry + resolve {allow:false}, no re-fire.
   *   - If remainingMs > 0 → restart timer with remainingMs + re-fire sendToClient.
   */
  function resumePending(snapshots: PtyRelaySnapshot[]): void {
    for (const snap of snapshots) {
      const entry = pending.get(snap.toolUseId);
      if (!entry) continue;

      const remainingMs = timeoutMs - snap.elapsedMs;
      if (remainingMs <= 0) {
        // Expired: deny and remove
        pending.delete(snap.toolUseId);
        entry.resolve({ allow: false });
      } else {
        // Restart timer with remaining time
        const newTimerId = setTimeoutFn(() => {
          pending.delete(snap.toolUseId);
          entry.resolve({ allow: false });
        }, remainingMs);
        entry.timerId = newTimerId;
        // Re-fire sendToClient so client sees the permission request again
        sendToClient(entry.sessionId, snap.toolUseId, {
          name: entry.toolName,
          parameters: entry.toolInput,
        });
      }
    }
  }

  return {
    requestPtyPermission,
    resolvePermission,
    getPendingCount,
    pausePending,
    resumePending,
  };
}
