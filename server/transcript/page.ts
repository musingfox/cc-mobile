import { epochOf } from "./epoch";
import { readTranscriptSince, type TranscriptCursor } from "./reader";
import { transcriptRecordToChunk } from "./records";

export interface PageCursor {
  epoch: string;
  seq: number;
  recordId: string;
}

export interface TranscriptPage {
  records: Array<Record<string, unknown>>;
  nextBefore: PageCursor | null;
}

export interface ReadPageInput {
  path: string;
  before?: PageCursor | null;
  limit?: number;
}

/** Returns page of mapper-non-null records immediately older than `before`, oldest first. */
export async function readTranscriptPage(input: ReadPageInput): Promise<TranscriptPage> {
  const { path, before = null, limit = 50 } = input;
  const { records: raw, offsets } = await readTranscriptSince({
    path,
    cursor: { byteOffset: 0, lastUuid: null },
  });
  const items: Array<{ chunk: Record<string, unknown>; seq: number; recordId?: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = transcriptRecordToChunk(raw[i]);
    if (ch) {
      const rid = (ch as any).recordId as string | undefined;
      items.push({ chunk: ch, seq: offsets?.[i] ?? 0, recordId: rid });
    }
  }
  if (items.length === 0) return { records: [], nextBefore: null };

  // items ascending oldest to newest
  let cut = items.length; // index of first item that is "newer or at the before point"
  if (before) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if ((before.recordId && it.recordId === before.recordId && it.seq === before.seq) || it.seq >= before.seq) {
        cut = i;
        break;
      }
    }
  }
  const older = items.slice(0, cut);
  const take = older.slice(Math.max(0, older.length - limit));
  const pageRecords = take.map((it) => ({ ...it.chunk, seq: it.seq }));
  let nextBefore: PageCursor | null = null;
  if (take.length > 0 && take[0].recordId) {
    nextBefore = { epoch: epochOf(path), seq: take[0].seq, recordId: take[0].recordId };
    if (take[0].seq === (items[0]?.seq ?? -1)) nextBefore = null;
  }
  return { records: pageRecords, nextBefore };
}
