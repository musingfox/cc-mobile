/**
 * delivery.ts — TranscriptTurnDelivery + TranscriptWorkingTail: transcript
 * records reaching the phone as chat messages.
 *
 * This is the replacement for the Stop-hook readback chain. herdr tells us when
 * a session settles (`pane.updated`), the transcript tells us what it said, and
 * the existing `stream_chunk` / `stream_end` envelope carries it to the client
 * unchanged (Decision M1).
 *
 * Two triggers, one cursor (Decision M4):
 *   settle  — everything written since the last delivery, terminated by exactly
 *             one `stream_end`.
 *   tail    — while herdr reports `working`, a 1 s `stat`-gated read so the turn
 *             appears as it is written. Never sends `stream_end`: only a settle
 *             ends a turn.
 * Sharing one cursor is what keeps a record from being delivered twice when a
 * tail read is followed by the settle for the same turn.
 *
 * Two rules that look like bugs and are not:
 *   - The cursor advances on every successful read even when nothing is
 *     delivered. A session no client has ever bound has no event buffer to
 *     replay from, so holding its records back would only queue a backlog that
 *     Decision M3 says must never land in the chat view.
 *   - `legacyReadback(sessionId)` suppresses delivery for sessions whose replies
 *     still arrive through the hook pipeline, so `main` never double-delivers
 *     during the migration (Decision M7). It is deleted with the pipeline.
 */

import {
  defaultTranscriptReadFs,
  initCursorAtEof,
  readTranscriptSince,
  type TranscriptCursor,
  type TranscriptReadResult,
} from "./reader";
import { type TranscriptChunk, transcriptRecordToChunk } from "./records";

export type ClientSink = (msg: Record<string, unknown>) => void;

export const DEFAULT_TAIL_INTERVAL_MS = 1_000;

/** Handle returned by the injected interval scheduler. */
export type TimerHandle = unknown;

export interface TranscriptDeliveryOptions {
  /** sessionId (pane id) → transcript path, or null when it cannot be located. */
  resolvePath: (sessionId: string) => Promise<string | null>;
  /** Late-bound sink lookup: a reconnect that rebound the session must win. */
  getSink: (sessionId: string) => ClientSink | undefined;
  /** Migration-window suppression (Decision M7). Defaults to "never suppress". */
  legacyReadback?: (sessionId: string) => boolean;
  read?: (input: { path: string; cursor: TranscriptCursor }) => Promise<TranscriptReadResult>;
  initCursor?: (input: { path: string }) => Promise<TranscriptCursor>;
  toChunk?: (record: unknown) => TranscriptChunk | null;
  /** Byte size of the transcript, or null when it cannot be read. */
  stat?: (path: string) => Promise<number | null>;
  tailIntervalMs?: number;
  setIntervalFn?: (fn: () => void, ms: number) => TimerHandle;
  clearIntervalFn?: (handle: TimerHandle) => void;
}

interface SessionState {
  path: string | null;
  cursor: TranscriptCursor;
  tail?: TimerHandle;
  /** Tail-only: true while a read is in flight, so a tick skips instead of piling up. */
  reading: boolean;
  /** A tail read has streamed chunks that no `stream_end` has closed yet. */
  turnOpen: boolean;
  /** Serialises reads per session — two readers must never share one cursor. */
  queue: Promise<void>;
}

export function createTranscriptDelivery(options: TranscriptDeliveryOptions) {
  const {
    resolvePath,
    getSink,
    legacyReadback = () => false,
    read = readTranscriptSince,
    initCursor = initCursorAtEof,
    toChunk = transcriptRecordToChunk,
    stat = (path: string) => defaultTranscriptReadFs.size(path),
    tailIntervalMs = DEFAULT_TAIL_INTERVAL_MS,
  } = options;
  const setIntervalFn =
    options.setIntervalFn ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearIntervalFn =
    options.clearIntervalFn ??
    ((handle: TimerHandle) => clearInterval(handle as ReturnType<typeof setInterval>));

  const states = new Map<string, SessionState>();
  /** In-flight first builds, so concurrent callers share one state, not two. */
  const building = new Map<string, Promise<SessionState>>();

  /**
   * The session's state, created on first contact with its cursor at
   * end-of-file so attaching mid-conversation replays nothing (Decision M3).
   *
   * Single-flight by construction: one `pane.updated` carries the pane's session
   * id *and* its status, so the identity handler and the status handler reach
   * here at the same moment for a pane neither has seen. Building two states
   * would leave one of them — and the tail timer it holds — unreachable, i.e. a
   * 1 s stat loop nothing can stop.
   */
  function ensureState(sessionId: string): Promise<SessionState> {
    const existing = states.get(sessionId);
    if (existing) {
      if (existing.path !== null) return Promise.resolve(existing);
      return resolvePath(sessionId).then((path) => {
        existing.path = path;
        return existing;
      });
    }

    const inFlight = building.get(sessionId);
    if (inFlight) return inFlight;

    const build = (async () => {
      const path = await resolvePath(sessionId);
      const cursor = path ? await initCursor({ path }) : { byteOffset: 0, lastUuid: null };
      const state: SessionState = {
        path,
        cursor,
        reading: false,
        turnOpen: false,
        queue: Promise.resolve(),
      };
      states.set(sessionId, state);
      return state;
    })().finally(() => {
      building.delete(sessionId);
    });

    building.set(sessionId, build);
    return build;
  }

  /**
   * Reads what is new and returns the renderable chunks, advancing the cursor.
   *
   * Reads for one session are serialised rather than dropped: a settle landing
   * while a tail read is still in flight must still read the rest of the turn,
   * or the turn ends with chunks the phone never receives.
   */
  function pull(sessionId: string, state: SessionState): Promise<TranscriptChunk[]> {
    const next = state.queue.then(async () => {
      if (!state.path) return [];
      state.reading = true;
      try {
        const result = await read({ path: state.path, cursor: state.cursor });
        // Advance first: suppressed or undeliverable records are dropped, never
        // queued (see the module header).
        state.cursor = result.cursor;
        if (legacyReadback(sessionId)) return [];
        const chunks: TranscriptChunk[] = [];
        for (const record of result.records) {
          const chunk = toChunk(record);
          if (chunk) chunks.push(chunk);
        }
        return chunks;
      } finally {
        state.reading = false;
      }
    });
    // The queue must survive a failed read, or one error wedges the session.
    state.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Registers a session without delivering anything — the cursor lands at the
   * current end of file. Idempotent.
   */
  async function attach(sessionId: string): Promise<void> {
    await ensureState(sessionId);
  }

  /**
   * A turn settled: deliver everything written since the last read, then one
   * `stream_end`. Emits nothing at all when the turn produced no renderable
   * record *and* the tail streamed none either — a bare `stream_end` would close
   * a turn the phone never saw open. A turn the tail already streamed in full
   * still gets its end marker here, because only a settle ends a turn.
   */
  async function deliverTurn(sessionId: string): Promise<void> {
    const state = await ensureState(sessionId);
    const chunks = await pull(sessionId, state);
    if (chunks.length === 0 && !state.turnOpen) return;

    const sink = getSink(sessionId);
    if (!sink) {
      state.turnOpen = false;
      return;
    }

    for (const chunk of chunks) {
      sink({ type: "stream_chunk", sessionId, chunk });
    }
    sink({ type: "stream_end", sessionId });
    state.turnOpen = false;
  }

  /** Mid-turn tail read: chunks only, never an end marker. */
  async function tailOnce(sessionId: string): Promise<void> {
    const state = states.get(sessionId);
    if (!state?.path || state.reading) return;

    let size: number | null;
    try {
      size = await stat(state.path);
    } catch {
      // A stat failure skips this tick; the next one (or the settle) catches up.
      return;
    }
    if (size === null || size <= state.cursor.byteOffset) return;

    const chunks = await pull(sessionId, state);
    if (chunks.length === 0) return;
    const sink = getSink(sessionId);
    if (!sink) return;
    for (const chunk of chunks) {
      sink({ type: "stream_chunk", sessionId, chunk });
    }
    // The settle owes this turn an end marker even if it finds nothing new.
    state.turnOpen = true;
  }

  function stopTail(sessionId: string): void {
    const state = states.get(sessionId);
    if (!state?.tail) return;
    clearIntervalFn(state.tail);
    state.tail = undefined;
  }

  /**
   * herdr status for a session. `working` arms the tail; anything else stops it
   * (the settle path delivers the rest of the turn).
   */
  async function onStatus(sessionId: string, status: string): Promise<void> {
    if (status !== "working") {
      stopTail(sessionId);
      return;
    }

    const state = await ensureState(sessionId);
    if (state.tail !== undefined) return;
    state.tail = setIntervalFn(() => {
      void tailOnce(sessionId);
    }, tailIntervalMs);
  }

  /**
   * The session's conversation changed identity (`/clear`, or a claude that
   * exited and was replaced): forget the old file and re-attach at the new
   * one's end of file, so a dead transcript is never tailed (P6).
   */
  async function resetCursor(sessionId: string): Promise<void> {
    stopTail(sessionId);
    states.delete(sessionId);
    await ensureState(sessionId);
  }

  /** Session gone: drop its cursor and its timer. */
  function forget(sessionId: string): void {
    stopTail(sessionId);
    states.delete(sessionId);
  }

  function stopAll(): void {
    for (const sessionId of [...states.keys()]) stopTail(sessionId);
  }

  /** Test/inspection seam: the cursor this session would read from next. */
  function cursorFor(sessionId: string): TranscriptCursor | undefined {
    return states.get(sessionId)?.cursor;
  }

  return { attach, deliverTurn, onStatus, resetCursor, forget, stopAll, cursorFor };
}

export type TranscriptDelivery = ReturnType<typeof createTranscriptDelivery>;
