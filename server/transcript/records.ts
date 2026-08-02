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
 *
 * Three `user`/`assistant` records are bookkeeping too, and are dropped by flag
 * rather than by type (shapes confirmed against real transcripts under
 * `~/.claude/projects`, 2026-08-02):
 *   isSidechain      — a sub-agent's own conversation. Current claude writes it
 *                      to `<session>/subagents/*.jsonl`, but the flag rides on
 *                      the record, so a build that inlines it into the main file
 *                      cannot flood the phone with a Task tool's internals.
 *   isMeta           — text claude injects on the user's behalf: skill preludes,
 *                      `<local-command-caveat>` and friends. Nobody typed it.
 *   isCompactSummary — the "This session is being continued from a previous
 *                      conversation…" record written after a compaction, which
 *                      reads exactly like a user prompt and is not one.
 */

/** The `chunk` payload of a `stream_chunk` message. */
export type TranscriptChunk = Record<string, unknown>;

const RENDERABLE_TYPES = new Set(["user", "assistant"]);

/** Flags that mark a conversational record as not part of the conversation. */
const SUPPRESSING_FLAGS = ["isSidechain", "isMeta", "isCompactSummary"] as const;

/**
 * `null` for every record that must not be rendered. Never throws: a record
 * that is not even an object is simply not a chunk.
 */
export function transcriptRecordToChunk(record: unknown): TranscriptChunk | null {
  if (typeof record !== "object" || record === null) return null;

  const fields = record as Record<string, unknown>;
  for (const flag of SUPPRESSING_FLAGS) {
    if (fields[flag] === true) return null;
  }

  const { type, message } = record as { type?: unknown; message?: unknown };
  if (typeof type !== "string" || !RENDERABLE_TYPES.has(type)) return null;
  // A conversational record with no message body carries nothing to show.
  if (typeof message !== "object" || message === null) return null;

  return { type, message };
}
