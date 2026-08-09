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
 */

import { epochOf } from "./epoch";
import { transcriptRecordToChunk } from "./records";
import { readTranscriptSince, type TranscriptReadFs } from "./reader";

/**
 * Records per page. Fixed on the server and absent from the wire: a client
 * cannot ask for a bigger frame than the server is willing to build.
 */
export const TRANSCRIPT_PAGE_SIZE = 50;

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
   * Names the oldest record in this page, for the next request. `null` means
   * no mapper-non-null record exists before this page — the conversation
   * starts here.
   */
  nextBefore: PageCursor | null;
}

export interface ReadPageInput {
  path: string;
  before?: PageCursor | null;
  limit?: number;
  fs?: TranscriptReadFs;
}

interface PageItem {
  chunk: Record<string, unknown>;
  seq: number;
  recordId?: string;
}

/**
 * Index the page ends at. A cursor is honoured only when it names the file we
 * just read *and* the record living at that byte offset still carries the id
 * the client remembers. Anything else — a rotated file, an in-place rewrite
 * that shifted the offsets, a position past EOF — falls through to "the newest
 * page", which is always a correct answer about the current conversation.
 */
function cutIndexFor(items: PageItem[], before: PageCursor | null, epoch: string): number {
  if (!before || before.epoch !== epoch) return items.length;
  const index = items.findIndex(
    (item) => item.seq === before.seq && item.recordId === before.recordId,
  );
  return index >= 0 ? index : items.length;
}

/** Returns the page of mapper-non-null records immediately older than `before`. */
export async function readTranscriptPage(input: ReadPageInput): Promise<TranscriptPage> {
  const { path, before = null, limit = TRANSCRIPT_PAGE_SIZE } = input;
  const epoch = epochOf(path);

  // Whole-file read: the reader's cursor is forward-only, and a backward window
  // has no anchor to start from until the records are known. Measured at 14–32 ms
  // on the largest transcripts on this machine (12.9 MB / 11.4 MB).
  const { records: raw, offsets } = await readTranscriptSince({
    path,
    cursor: { byteOffset: 0, lastUuid: null },
    ...(input.fs ? { fs: input.fs } : {}),
  });

  const items: PageItem[] = [];
  for (let index = 0; index < raw.length; index++) {
    const chunk = transcriptRecordToChunk(raw[index]);
    if (!chunk) continue;
    const recordId = typeof chunk.recordId === "string" ? chunk.recordId : undefined;
    items.push({ chunk, seq: offsets[index] ?? 0, recordId });
  }
  if (items.length === 0) return { epoch, records: [], nextBefore: null };

  const cut = cutIndexFor(items, before, epoch);
  const start = Math.max(0, cut - limit);
  const take = items.slice(start, cut);

  // `nextBefore` can only name a record that has an id. Every claude and omp
  // record does; a page whose oldest entries somehow have none names the oldest
  // one that does, so the next request still moves backwards.
  const anchor = start > 0 ? take.find((item) => item.recordId !== undefined) : undefined;

  return {
    epoch,
    records: take.map((item) => ({ ...item.chunk, seq: item.seq, epoch })),
    nextBefore: anchor ? { epoch, seq: anchor.seq, recordId: anchor.recordId as string } : null,
  };
}
