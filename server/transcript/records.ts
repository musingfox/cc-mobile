/**
 * records.ts — TranscriptRecordToChunk: one JSONL record → one `stream_chunk`
 * payload, or nothing.
 *
 * Decision M1 keeps the existing `stream_chunk` envelope: a transcript record's
 * `message` object *is* the Anthropic message shape the client's dispatcher
 * already renders (`text` / `thinking` / `tool_use` blocks on assistant turns,
 * a bare string or `tool_result` blocks on user turns). So the mapping is a
 * pass-through, not a translation — nothing is reshaped, and a block this
 * server has never heard of reaches the client intact.
 *
 * Everything else claude writes into the file is bookkeeping: checkpointing
 * (`file-history-snapshot` / `file-history-delta`), turn metadata (`system`
 * subtypes, `ai-title`, `mode`, `permission-mode`, `queue-operation`) and hook
 * output (`attachment`). Those yield `null` — an unrecognised type is never
 * guessed into a chat bubble.
 */

/** The `chunk` payload of a `stream_chunk` message. */
export type TranscriptChunk = Record<string, unknown>;

const RENDERABLE_TYPES = new Set(["user", "assistant"]);

/**
 * `null` for every record that must not be rendered. Never throws: a record
 * that is not even an object is simply not a chunk.
 */
export function transcriptRecordToChunk(record: unknown): TranscriptChunk | null {
  if (typeof record !== "object" || record === null) return null;

  const { type, message } = record as { type?: unknown; message?: unknown };
  if (typeof type !== "string" || !RENDERABLE_TYPES.has(type)) return null;
  // A conversational record with no message body carries nothing to show.
  if (typeof message !== "object" || message === null) return null;

  return { type, message };
}
