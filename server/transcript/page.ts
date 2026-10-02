/**
 * page.ts — one page of a transcript, read backwards from a point the phone names.
 *
 * The live path tails a transcript forward; history runs the other way. A page
 * is `TRANSCRIPT_PAGE_SIZE` mapper-non-null records ending strictly before the
 * cursor the client sends back, oldest→newest, so the client can prepend it
 * whole. The page unit is "records the mapper keeps", never "records the client
 * renders" — deciding what is visible is the client's job (ADR-015 M1), and the
 * bodies here come out of the same `transcriptRecordToChunk` the live path uses.
 *
 * The cursor is a three-part receipt: it names the file (`epoch`) and the record
 * it stops before (`seq` + `recordId`). Both halves are re-proved against the
 * file on every request, because the path is resolved live and may have rotated
 * (a terminal `/clear`) since the client last read it. A receipt that does not
 * check out is not an error — it degrades to the newest page of the current
 * file, self-described by the `epoch` in the reply.
 *
 * Reads are bounded to one byte window ending at the validated cursor (or EOF).
 * Cursor validation is a targeted probe at `before.seq`, not a scan of the page.
 */

import { epochOf } from "./epoch";
import {
  defaultTranscriptReadFs,
  readTranscriptWindow,
  TRANSCRIPT_WINDOW_BYTES,
  type TranscriptReadFs,
} from "./reader";
import { ownRecordId, transcriptRecordToChunk } from "./records";

/**
 * Records per page. Fixed on the server and absent from the wire: a client
 * cannot ask for a bigger frame than the server is willing to build. A page
 * runs past it only to reach a record it can name (see `nextBefore`), still
 * inside one window — no claude or omp page needs to, since every record of
 * theirs has an id.
 */
export const TRANSCRIPT_PAGE_SIZE = 50;

/** Probe budget for proving the record at `before.seq`. */
export const TRANSCRIPT_PROBE_BYTES = 256 * 1024;

const MAX_EMPTY_WINDOW_HOPS = 4;

/** Where a page stops, and which file that position is measured in. */
export interface PageCursor {
  epoch: string;
  seq: number;
  recordId: string;
}

export interface TranscriptPage {
  /** The file this page was actually read from — never the requested one. */
  epoch: string;
  /** Mapper-non-null chunks, oldest→newest, each stamped with `seq` and `epoch`. */
  records: Array<Record<string, unknown>>;
  /**
   * Names the oldest record in this page, for the next request. `null` is a
   * statement about the file, not about this read: it means the window reached
   * byte 0 with nothing older left — the conversation starts here — and the
   * phone retires its "load earlier" entrance on it. A page of records with no
   * id of their own names the nearest record before it instead, taking in
   * whatever the mapper keeps between the two so the exclusive cursor steps
   * over nothing. A read that still finds nothing to name (hops spent, or no
   * named record older than the page in its window) hands back the deepest
   * cursor it can prove, down to the caller's own; only a first page in that
   * position is left with `null` as the sole expressible answer.
   */
  nextBefore: PageCursor | null;
}

export interface ReadPageInput {
  path: string;
  before?: PageCursor | null;
  limit?: number;
  fs?: TranscriptReadFs;
  maxBytes?: number;
  probeBytes?: number;
}

interface PageItem {
  chunk: Record<string, unknown>;
  seq: number;
  recordId?: string;
}

function recordIdOf(record: unknown, chunk: Record<string, unknown> | null): string | undefined {
  if (chunk && typeof chunk.recordId === "string") return chunk.recordId;
  const fields = record as { uuid?: unknown; id?: unknown } | null;
  return ownRecordId(fields?.uuid, fields?.id);
}

/**
 * Prove `before` against the file. Returns the exclusive end offset to read
 * up to, or `null` to take the newest page (EOF).
 */
async function endOffsetForCursor(
  fs: TranscriptReadFs,
  path: string,
  size: number,
  before: PageCursor | null,
  epoch: string,
  probeBytes: number,
): Promise<number> {
  if (!before || before.epoch !== epoch) return size;
  if (before.seq < 0 || before.seq >= size) return size;

  const probeEnd = Math.min(size, before.seq + probeBytes);
  const slice = await fs.readSlice(path, before.seq, probeEnd);
  const newlineAt = slice.indexOf("\n");
  if (newlineAt === -1) {
    // Failing to prove is not disproving: accept the cursor.
    return before.seq;
  }
  const line = slice.slice(0, newlineAt);
  try {
    const record = JSON.parse(line) as unknown;
    const chunk = transcriptRecordToChunk(record);
    const id = recordIdOf(record, chunk);
    if (id === before.recordId) return before.seq;
  } catch {
    return size;
  }
  return size;
}

/**
 * The oldest record in the window that can name itself and sits before
 * `limitSeq`. Mapper-null records count: `endOffsetForCursor` proves a cursor
 * off the raw record, so a bookkeeping line is a perfectly good place to stop.
 */
function oldestNamedCursor(
  records: unknown[],
  offsets: number[],
  limitSeq: number,
  epoch: string,
): PageCursor | null {
  for (let index = 0; index < records.length; index++) {
    const seq = offsets[index] ?? 0;
    if (seq >= limitSeq) continue;
    const record = records[index];
    const id = recordIdOf(record, transcriptRecordToChunk(record));
    if (id !== undefined) return { epoch, seq, recordId: id };
  }
  return null;
}

/**
 * The record before a batch that cannot name itself, and how far back the page
 * must reach to keep it honest. The cursor is exclusive, so every record the
 * mapper keeps between that record and the batch — and the record itself when
 * the mapper keeps it — joins the page instead of being stepped over. `from` is
 * the index into the window's items where the page then starts.
 */
function nameTheRecordBefore(
  records: unknown[],
  offsets: number[],
  batchStart: number,
  batchSeq: number,
  epoch: string,
): { from: number; cursor: PageCursor | null } {
  let from = batchStart;
  for (let index = records.length - 1; index >= 0; index--) {
    const seq = offsets[index] ?? 0;
    if (seq >= batchSeq) continue;
    const record = records[index];
    const chunk = transcriptRecordToChunk(record);
    if (chunk) from -= 1;
    const recordId = recordIdOf(record, chunk);
    if (recordId !== undefined) return { from, cursor: { epoch, seq, recordId } };
  }
  return { from, cursor: null };
}

function itemsFromWindow(
  records: unknown[],
  offsets: number[],
  endExclusive: number,
): PageItem[] {
  const items: PageItem[] = [];
  for (let index = 0; index < records.length; index++) {
    const chunk = transcriptRecordToChunk(records[index]);
    if (!chunk) continue;
    const seq = offsets[index] ?? 0;
    if (seq >= endExclusive) continue;
    const recordId = typeof chunk.recordId === "string" ? chunk.recordId : undefined;
    items.push({ chunk, seq, recordId });
  }
  return items;
}

/** Returns the page of mapper-non-null records immediately older than `before`. */
export async function readTranscriptPage(input: ReadPageInput): Promise<TranscriptPage> {
  const { path, before = null, limit = TRANSCRIPT_PAGE_SIZE } = input;
  const fs = input.fs ?? defaultTranscriptReadFs;
  const maxBytes = input.maxBytes ?? TRANSCRIPT_WINDOW_BYTES;
  const probeBytes = input.probeBytes ?? TRANSCRIPT_PROBE_BYTES;
  const epoch = epochOf(path);

  const size = await fs.size(path);
  if (size === null) return { epoch, records: [], nextBefore: null };

  const endOffset = await endOffsetForCursor(fs, path, size, before, epoch, probeBytes);

  // Only a cursor the probe accepted may be handed back: reflecting a rejected
  // one would send the client round a loop that degrades to the newest page.
  const honouredBefore = before !== null && endOffset === before.seq ? before : null;

  let hopEnd = endOffset;
  let windowStart = hopEnd;
  let items: PageItem[] = [];
  let lastRecords: unknown[] = [];
  let lastOffsets: number[] = [];
  // The end the last window was actually read to — `hopEnd` walks past it.
  let lastEnd = hopEnd;
  for (let hop = 0; hop < MAX_EMPTY_WINDOW_HOPS; hop++) {
    const window = await readTranscriptWindow({ path, end: hopEnd, maxBytes, fs });
    windowStart = window.windowStart;
    lastEnd = hopEnd;
    lastRecords = window.records;
    lastOffsets = window.offsets;
    items = itemsFromWindow(window.records, window.offsets, hopEnd);
    if (items.length > 0) break;
    if (window.windowStart === 0) break;
    hopEnd = window.windowStart;
  }

  if (items.length === 0) {
    // Reaching byte 0 with nothing renderable is the head. Spending the hop
    // budget is not: the file goes on, and everything hopped over was
    // mapper-null, so the oldest of those is a cursor that both keeps the
    // entrance open and makes real progress.
    if (windowStart === 0) return { epoch, records: [], nextBefore: null };
    const deeper = oldestNamedCursor(lastRecords, lastOffsets, lastEnd, epoch);
    return { epoch, records: [], nextBefore: deeper ?? honouredBefore };
  }

  const start = Math.max(0, items.length - limit);
  let take = items.slice(start);
  const tookEvery = start === 0;
  const reachedHead = windowStart === 0 && tookEvery;

  let nextBefore: PageCursor | null = null;
  if (!reachedHead) {
    const anchor = take.find((item) => item.recordId !== undefined);
    if (anchor) {
      nextBefore = { epoch, seq: anchor.seq, recordId: anchor.recordId as string };
    } else if (tookEvery) {
      // Nothing in the page can name itself, and everything older in this
      // window is mapper-null, so any named record there is safe to point at.
      // Failing that, the caller's own cursor: the same page again, which costs
      // a re-read but hides nothing.
      const deeper = oldestNamedCursor(lastRecords, lastOffsets, take[0]?.seq ?? lastEnd, epoch);
      nextBefore = deeper ?? honouredBefore;
    } else {
      const batchSeq = take[0]?.seq ?? lastEnd;
      const before = nameTheRecordBefore(lastRecords, lastOffsets, start, batchSeq, epoch);
      if (before.cursor) {
        take = items.slice(before.from);
        nextBefore = before.cursor;
      } else if (windowStart === 0) {
        // Nothing older can be named, but the head is in this window: the page
        // runs to it, and `null` is then true.
        take = items;
      } else {
        nextBefore = honouredBefore;
      }
    }
  }

  return {
    epoch,
    records: take.map((item) => ({ ...item.chunk, seq: item.seq, epoch })),
    nextBefore,
  };
}
