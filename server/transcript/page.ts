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
import { transcriptRecordToChunk } from "./records";

/**
 * Records per page. Fixed on the server and absent from the wire: a client
 * cannot ask for a bigger frame than the server is willing to build.
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
   * phone retires its "load earlier" entrance on it. A read that simply could
   * not name a record (hops spent, or a page of records with no id of their
   * own) hands back the deepest cursor it can prove instead, down to the
   * caller's own; only a file with no addressable record anywhere is left with
   * `null` as the sole expressible answer.
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
  if (typeof fields?.uuid === "string") return fields.uuid;
  if (typeof fields?.id === "string") return fields.id;
  return undefined;
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
  const take = items.slice(start);
  const tookEvery = start === 0;
  const reachedHead = windowStart === 0 && tookEvery;

  let nextBefore: PageCursor | null = null;
  if (!reachedHead) {
    const anchor = take.find((item) => item.recordId !== undefined);
    if (anchor) {
      nextBefore = { epoch, seq: anchor.seq, recordId: anchor.recordId as string };
    } else {
      // Nothing in the page can name itself. A record older than the page is
      // safe to point at only when the page took every item this window kept —
      // then all that is skipped is mapper-null. Otherwise the caller's own
      // cursor: the same page again, which costs a re-read but hides nothing.
      const deeper = tookEvery
        ? oldestNamedCursor(lastRecords, lastOffsets, take[0]?.seq ?? lastEnd, epoch)
        : null;
      nextBefore = deeper ?? honouredBefore;
    }
  }

  return {
    epoch,
    records: take.map((item) => ({ ...item.chunk, seq: item.seq, epoch })),
    nextBefore,
  };
}
