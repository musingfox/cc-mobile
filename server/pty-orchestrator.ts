/**
 * pty-orchestrator.ts — PTY session lifecycle orchestration for ADR-011 hybrid architecture.
 *
 * Hard constraints:
 *   - NO top-level import of node-pty
 *   - NO top-level import of SDK (query, getSessionMessages, etc.)
 *   - Injection seams: spawner, getMessagesFn (both per-constructor and per-drive-call)
 *
 * Public API:
 *   - drive(sessionId, cwd, prompt, send, opts?): Promise<void>
 *   - cancel(sessionId): void
 */

import type { SpawnerFn } from "./pty-driver";
import type { GetMessagesFn } from "./pty-reader";
import { runPtySession } from "./pty-reader";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PtyOrchestratorOptions {
  /** Injectable spawner (omit to use real default). */
  spawner?: SpawnerFn;
  /** Injectable poll function (omit to use real SDK dynamic import). */
  getMessagesFn?: GetMessagesFn;
  /** Poll timeout in ms. Default: 60000. */
  timeout?: number;
  /** Poll interval in ms. Default: 500. */
  interval?: number;
}

export interface DriveOptions {
  spawner?: SpawnerFn;
  getMessagesFn?: GetMessagesFn;
  timeout?: number;
  interval?: number;
  /** Optional predicate: freeze the poll deadline while a permission is pending. */
  isPermissionPending?: () => boolean;
  /** Injectable clock seam (test): wall-clock reader. Default: Date.now. */
  nowFn?: () => number;
  /** Injectable clock seam (test): timer scheduler. Default: setTimeout. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  /** Injectable clock seam (test): timer canceller. Default: clearTimeout. */
  clearTimeoutFn?: (id: unknown) => void;
}

interface SessionState {
  handle?: { kill: () => void; exited: Promise<number> };
  cancelled: boolean;
}

// ── PtyOrchestrator ────────────────────────────────────────────────────────

/**
 * Manages per-session PTY handles: kill-prior on re-drive (H3),
 * cancel-during-spawn (H4), reply-to-send forwarding (E1).
 */
export class PtyOrchestrator {
  private readonly spawner?: SpawnerFn;
  private readonly getMessagesFn?: GetMessagesFn;
  private readonly timeout?: number;
  private readonly interval?: number;

  private readonly sessions = new Map<string, SessionState>();

  constructor(opts?: PtyOrchestratorOptions) {
    this.spawner = opts?.spawner;
    this.getMessagesFn = opts?.getMessagesFn;
    this.timeout = opts?.timeout;
    this.interval = opts?.interval;
  }

  /**
   * Drive a prompt through the PTY path for the given session.
   *
   * Ordering guarantees:
   *   H3: if a prior handle exists for this session, kill it before spawning.
   *   H4: if cancel() fires during spawn (inside onHandle), kill handle immediately
   *       and suppress send.
   *
   * @param sessionId    ws-layer session ID
   * @param cwd          working directory for the spawned process
   * @param prompt       prompt text to inject
   * @param send         callback to deliver server messages to the client
   * @param opts         per-call overrides for spawner/getMessagesFn/timeout/interval
   */
  async drive(
    sessionId: string,
    cwd: string,
    prompt: string,
    send: (msg: unknown) => void,
    opts?: DriveOptions,
  ): Promise<void> {
    // Resolve effective opts (per-call overrides constructor defaults)
    const effectiveSpawner = opts?.spawner ?? this.spawner;
    const effectiveGetMessagesFn = opts?.getMessagesFn ?? this.getMessagesFn;
    const effectiveTimeout = opts?.timeout ?? this.timeout;
    const effectiveInterval = opts?.interval ?? this.interval;

    // H3: kill prior handle if alive
    const existing = this.sessions.get(sessionId);
    if (existing?.handle) {
      existing.handle.kill();
      existing.handle = undefined;
    }

    // Reset (or create) session state with cancelled=false
    const state: SessionState = { cancelled: false };
    this.sessions.set(sessionId, state);

    // Drive via runPtySession with onHandle seam
    let reply: string;
    try {
      reply = await runPtySession(sessionId, cwd, prompt, {
        ...(effectiveSpawner ? { spawner: effectiveSpawner } : {}),
        ...(effectiveGetMessagesFn ? { getMessagesFn: effectiveGetMessagesFn } : {}),
        ...(effectiveTimeout !== undefined ? { timeout: effectiveTimeout } : {}),
        ...(effectiveInterval !== undefined ? { interval: effectiveInterval } : {}),
        ...(opts?.isPermissionPending ? { isPermissionPending: opts.isPermissionPending } : {}),
        ...(opts?.nowFn ? { nowFn: opts.nowFn } : {}),
        ...(opts?.setTimeoutFn ? { setTimeoutFn: opts.setTimeoutFn } : {}),
        ...(opts?.clearTimeoutFn ? { clearTimeoutFn: opts.clearTimeoutFn } : {}),
        onHandle: (handle) => {
          // H4: check cancelled flag synchronously (may have been set during spawn)
          if (state.cancelled) {
            handle.kill();
            return;
          }
          // Store handle for future cancel()
          state.handle = handle;
        },
      });
    } catch (err) {
      // On error: clear handle, send error if not cancelled
      state.handle = undefined;
      if (!state.cancelled) {
        send({
          type: "error",
          code: "pty_error",
          message: err instanceof Error ? err.message : String(err),
          sessionId,
        });
      }
      if (this.sessions.get(sessionId) === state) this.sessions.delete(sessionId);
      return;
    }

    // Clear handle after successful resolve
    state.handle = undefined;

    // Suppress send if cancelled
    if (state.cancelled) {
      if (this.sessions.get(sessionId) === state) this.sessions.delete(sessionId);
      return;
    }

    // E1: send stream_chunk (assistant-shaped) then stream_end
    send({
      type: "stream_chunk",
      sessionId,
      chunk: {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: reply }],
          stop_reason: "end_turn",
        },
      },
    });
    send({
      type: "stream_end",
      sessionId,
    });
    if (this.sessions.get(sessionId) === state) this.sessions.delete(sessionId);
  }

  /**
   * Returns true if a session state is currently tracked in the Map.
   */
  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  /**
   * Cancel any in-flight PTY session for the given sessionId.
   *
   * Sets cancelled=true and kills the stored handle (if any).
   */
  cancel(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      // Create a cancelled state so onHandle (if it fires later) sees cancelled=true
      this.sessions.set(sessionId, { cancelled: true });
      return;
    }
    state.cancelled = true;
    if (state.handle) {
      state.handle.kill();
      state.handle = undefined;
    }
  }

  /**
   * Cancel all in-flight PTY sessions in the given list.
   *
   * Only cancels sessions whose IDs appear in sessionIds — does not touch others.
   */
  cancelAll(sessionIds: string[]): void {
    for (const id of sessionIds) {
      this.cancel(id);
    }
  }
}
