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
 * `~/.claude/projects`, 2026-08-02). Rule ids: docs/transcript-visibility.md.
 *   isSidechain      — L1-isSidechain. A sub-agent's own conversation. Current
 *                      claude writes it to `<session>/subagents/*.jsonl`, but the
 *                      flag rides on the record, so a build that inlines it into
 *                      the main file cannot flood the phone with a Task tool's
 *                      internals.
 *   isMeta           — L1-isMeta. Text claude injects on the user's behalf: skill
 *                      preludes, `<local-command-caveat>` and friends. Nobody typed it.
 *   isCompactSummary — L1-isCompactSummary. The "This session is being continued
 *                      from a previous conversation…" record written after a
 *                      compaction, which reads exactly like a user prompt and is
 *                      not one.
 *
 * ── omp (#32) ───────────────────────────────────────────────────────────────
 * omp writes a different vocabulary into its own file, and this one function
 * reads both. It is not told which agent wrote the record and does not need to
 * be: the two vocabularies do not overlap (omp puts every conversational record
 * under `type:"message"` with the role *inside*; claude uses the role *as* the
 * type), and which file gets read is already decided per kind by the reader
 * registry in agents/transcript-readers.ts. A kind with no reader never
 * produces a path, so its records never reach here to be misread.
 *
 * Types observed across every omp transcript on this machine (11 kinds, 2026-08-06):
 * `message` is the only conversational one (L1-omp-type-not-message). `custom` (pure event data),
 * `custom_message` (advisor/plugin output — `attribution:"agent"`, rendered as
 * agent speech if forwarded, which nothing asks for), `session`, `title`,
 * `title_change`, `model_change`, `thinking_level_change`, `compaction`,
 * `service_tier_change`, `ttsr_injection` and `credential_pin` are all
 * bookkeeping and yield `null`, exactly as claude's non-conversational types do.
 *
 * Of omp's six roles only `assistant` and `user` are forwarded (L1-omp-role-not-user-assistant). `toolResult`,
 * `developer`, `fileMention` and `bashExecution` are dropped: the client renders
 * `text` blocks on assistant records and nothing else, so forwarding them would
 * add invisible traffic, not visible content. Its `thinking` and `toolCall`
 * blocks ride along inside the content array and go unrendered — the same place
 * claude's `thinking` and `tool_use` blocks are already in.
 */

/** The `chunk` payload of a `stream_chunk` message. */
export type TranscriptChunk = Record<string, unknown>;

const RENDERABLE_TYPES = new Set(["user", "assistant"]);

/** Flags that mark a conversational record as not part of the conversation. */
const SUPPRESSING_FLAGS = ["isSidechain", "isMeta", "isCompactSummary"] as const;

/** omp's single conversational record type; the role lives inside the message. */
const OMP_RECORD_TYPE = "message";

/**
 * omp's `{type:"message", message:{role, content}}` in claude's envelope, so the
 * client's existing dispatcher renders it with no client change at all.
 */
function ompRecordToChunk(message: unknown): TranscriptChunk | null {
  if (typeof message !== "object" || message === null) return null;
  const { role } = message as { role?: unknown };
  if (typeof role !== "string" || !RENDERABLE_TYPES.has(role)) return null;
  return { type: role, message };
}

/**
 * `null` for every record that must not be rendered. Never throws: a record
 * that is not even an object is simply not a chunk.
 */
export function transcriptRecordToChunk(record: unknown): TranscriptChunk | null {
  if (typeof record !== "object" || record === null) return null;

  const fields = record as Record<string, unknown>;
  for (const flag of SUPPRESSING_FLAGS) {
    // L1-isSidechain / L1-isMeta / L1-isCompactSummary
    if (fields[flag] === true) return null;
  }

  const { type, message } = record as { type?: unknown; message?: unknown };
  if (type === OMP_RECORD_TYPE) {
    const chunk = ompRecordToChunk(message);
    if (!chunk) return null;
    const rid = (fields.id ?? fields.uuid) as string | undefined;
    if (rid) (chunk as any).recordId = rid;
    return chunk;
  }
  // L1-claude-type-not-user-assistant (and L1-omp-type-not-message for non-message types)
  if (typeof type !== "string" || !RENDERABLE_TYPES.has(type)) return null;
  // L1-conversational-no-message-body
  if (typeof message !== "object" || message === null) return null;

  const chunk: TranscriptChunk = { type, message };
  const rid = (fields.uuid ?? fields.id) as string | undefined;
  if (rid) (chunk as any).recordId = rid;
  return chunk;
}
