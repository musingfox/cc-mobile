/**
 * reader.ts — TranscriptIncrementalRead + TranscriptCursorInitAtEOF.
 *
 * claude appends one JSON record per line to `<session>.jsonl` and never
 * rewrites earlier lines in the cases we could observe (compaction appends a
 * `compact_boundary` record and keeps the pre-compact lines; `/clear` starts a
 * *new* file, which is a cursor reset, not a truncation — probe 2026-08-02).
 * Since that could not be proven for every path (`/rewind` was never probed),
 * the cursor carries a receipt as well as an offset:
 *
 *   {byteOffset, lastUuid} — re-read from 0 whenever the file is shorter than
 *   the offset, or the record ending exactly at the offset no longer carries
 *   `lastUuid`. That covers truncation and in-place rewrite without having to
 *   prove append-only (Decision M2).
 *
 * Offsets are BYTES, not characters: a transcript full of CJK or emoji would
 * otherwise drift by a few bytes per line and start slicing mid-record.
 *
 * Nothing here throws. A transcript that cannot be read is a session with no
 * readback, which the session list already renders honestly.
 */

/** How far back to look for the record that must end at `byteOffset`. */
const TAIL_WINDOW_BYTES = 64 * 1024;

/** Byte window for a bounded transcript read. One page of 50 records fits with margin. */
export const TRANSCRIPT_WINDOW_BYTES = 4 * 1024 * 1024;

export interface TranscriptCursor {
  /** Byte offset of the end of the last record handed out. */
  byteOffset: number;
  /** `uuid` of that record — the receipt that proves the file is the same one. */
  lastUuid: string | null;
}

export interface TranscriptReadResult {
  records: unknown[];
  /** Absolute byte offsets (start of line) for each record in `records`, parallel array. */
  offsets: number[];
  cursor: TranscriptCursor;
}

/** Injected fs seam. `size` answers null for a file that is not there. */
export interface TranscriptReadFs {
  size(path: string): Promise<number | null>;
  /** UTF-8 text of the byte range `[start, end)`. */
  readSlice(path: string, start: number, end: number): Promise<string>;
}

export const defaultTranscriptReadFs: TranscriptReadFs = {
  async size(path) {
    try {
      const file = Bun.file(path);
      if (!(await file.exists())) return null;
      return file.size;
    } catch {
      return null;
    }
  },
  async readSlice(path, start, end) {
    try {
      return await Bun.file(path).slice(start, end).text();
    } catch {
      return "";
    }
  },
};

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function uuidOf(record: unknown): string | null {
  const value = (record as { uuid?: unknown } | null)?.uuid;
  return typeof value === "string" ? value : null;
}

/**
 * Splits a chunk that starts on a record boundary into complete lines,
 * reporting how many bytes those lines occupy. A trailing line with no newline
 * is a half-written record: it is neither returned nor counted, so the next
 * read picks it up once claude finishes writing it.
 */
function completeLines(chunk: string): { lines: string[]; consumedBytes: number } {
  const lines: string[] = [];
  let consumedBytes = 0;
  let index = 0;

  while (index < chunk.length) {
    const newlineAt = chunk.indexOf("\n", index);
    if (newlineAt === -1) break;
    const line = chunk.slice(index, newlineAt);
    lines.push(line);
    consumedBytes += byteLength(line) + 1;
    index = newlineAt + 1;
  }

  return { lines, consumedBytes };
}

/** The record whose line ends exactly at `offset`, or null. */
async function recordEndingAt(
  fs: TranscriptReadFs,
  path: string,
  offset: number,
): Promise<unknown | null> {
  if (offset <= 0) return null;
  const start = Math.max(0, offset - TAIL_WINDOW_BYTES);
  const chunk = await fs.readSlice(path, start, offset);
  const withoutTrailingNewline = chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk;
  const lastLine = withoutTrailingNewline.slice(withoutTrailingNewline.lastIndexOf("\n") + 1);
  if (lastLine.trim().length === 0) return null;
  try {
    return JSON.parse(lastLine);
  } catch {
    return null;
  }
}

export interface ReadTranscriptSinceInput {
  path: string;
  cursor: TranscriptCursor;
  fs?: TranscriptReadFs;
  /** Cap applied only on the restart path. Forward-only reads ignore it. */
  maxBytes?: number;
}

export interface ReadTranscriptWindowInput {
  path: string;
  /** Exclusive end byte. */
  end: number;
  maxBytes: number;
  fs?: TranscriptReadFs;
}

export interface TranscriptWindowResult {
  records: unknown[];
  offsets: number[];
  windowStart: number;
}

function parseCompleteRecords(
  chunk: string,
  start: number,
): { records: unknown[]; offsets: number[]; consumedEnd: number } {
  const { lines, consumedBytes } = completeLines(chunk);
  const records: unknown[] = [];
  const offsets: number[] = [];
  let lineStart = start;
  for (const line of lines) {
    const lineBytes = byteLength(line) + 1;
    if (line.trim().length === 0) {
      lineStart += lineBytes;
      continue;
    }
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      lineStart += lineBytes;
      continue;
    }
    records.push(record);
    offsets.push(lineStart);
    lineStart += lineBytes;
  }
  return { records, offsets, consumedEnd: start + consumedBytes };
}

/**
 * Records in `[max(0, end - maxBytes), end)`. A window that starts mid-record
 * drops the partial first line. Offsets are absolute file bytes (`seq`).
 */
export async function readTranscriptWindow(
  input: ReadTranscriptWindowInput,
): Promise<TranscriptWindowResult> {
  const { path, end: requestedEnd, maxBytes } = input;
  const fs = input.fs ?? defaultTranscriptReadFs;
  const size = await fs.size(path);
  if (size === null) {
    return { records: [], offsets: [], windowStart: Math.max(0, requestedEnd - maxBytes) };
  }

  const end = Math.max(0, Math.min(requestedEnd, size));
  const windowStart = Math.max(0, end - maxBytes);
  if (windowStart >= end) {
    return { records: [], offsets: [], windowStart };
  }

  let chunk = await fs.readSlice(path, windowStart, end);
  let dataStart = windowStart;
  if (windowStart > 0) {
    const prev = await fs.readSlice(path, windowStart - 1, windowStart);
    if (prev !== "\n") {
      const newlineAt = chunk.indexOf("\n");
      if (newlineAt === -1) {
        return { records: [], offsets: [], windowStart };
      }
      const skip = byteLength(chunk.slice(0, newlineAt + 1));
      chunk = chunk.slice(newlineAt + 1);
      dataStart = windowStart + skip;
    }
  }

  const parsed = parseCompleteRecords(chunk, dataStart);
  return { records: parsed.records, offsets: parsed.offsets, windowStart };
}

/**
 * Records appended since `cursor`, plus the cursor to use next time.
 *
 * A malformed line is skipped rather than aborting the batch: one truncated
 * record must not cost the phone the rest of the turn.
 */
export async function readTranscriptSince(
  input: ReadTranscriptSinceInput,
): Promise<TranscriptReadResult> {
  const { path, cursor } = input;
  const fs = input.fs ?? defaultTranscriptReadFs;

  const size = await fs.size(path);
  // Missing file: the session may not have written anything yet. Keep the
  // cursor so a file that appears later is read from where we expect.
  if (size === null) return { records: [], offsets: [], cursor };

  let start = cursor.byteOffset;
  let restarted = false;
  if (start > size) {
    start = 0;
    restarted = true;
  } else if (cursor.lastUuid !== null && start > 0) {
    const anchor = await recordEndingAt(fs, path, start);
    if (uuidOf(anchor) !== cursor.lastUuid) {
      start = 0;
      restarted = true;
    }
  }

  if (restarted) {
    const cap = input.maxBytes ?? TRANSCRIPT_WINDOW_BYTES;
    const window = await readTranscriptWindow({ path, end: size, maxBytes: cap, fs });
    const last = window.records.length > 0 ? window.records[window.records.length - 1] : null;
    return {
      records: window.records,
      offsets: window.offsets,
      cursor: { byteOffset: size, lastUuid: uuidOf(last) },
    };
  }

  if (start === size) {
    return {
      records: [],
      offsets: [],
      cursor,
    };
  }

  const chunk = await fs.readSlice(path, start, size);
  const parsed = parseCompleteRecords(chunk, start);
  const lastUuid =
    parsed.records.length > 0
      ? uuidOf(parsed.records[parsed.records.length - 1])
      : cursor.lastUuid;

  return {
    records: parsed.records,
    offsets: parsed.offsets,
    cursor: { byteOffset: parsed.consumedEnd, lastUuid },
  };
}

/**
 * The cursor to attach with: the end of the last *complete* record.
 *
 * Attaching mid-conversation must not replay the backlog — a 2 500-line
 * session would land in the chat view as if it had just been said (Decision
 * M3). A half-written trailing line is excluded so the very next read is not
 * forced into a full re-read by its own anchor check.
 */
export async function initCursorAtEof(input: {
  path: string;
  fs?: TranscriptReadFs;
}): Promise<TranscriptCursor> {
  const fs = input.fs ?? defaultTranscriptReadFs;
  const size = await fs.size(input.path);
  // A file that does not exist yet is read from its start once it appears.
  if (size === null) return { byteOffset: 0, lastUuid: null };
  if (size === 0) return { byteOffset: 0, lastUuid: null };

  const start = Math.max(0, size - TAIL_WINDOW_BYTES);
  const chunk = await fs.readSlice(input.path, start, size);
  const { lines, consumedBytes } = completeLines(chunk);

  let lastUuid: string | null = null;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!line || line.trim().length === 0) continue;
    try {
      lastUuid = uuidOf(JSON.parse(line));
    } catch {
      lastUuid = null;
    }
    break;
  }

  return { byteOffset: start + consumedBytes, lastUuid };
}
