import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { epochOf } from "./epoch";
import { readTranscriptPage } from "./page";
import { defaultTranscriptReadFs, TRANSCRIPT_WINDOW_BYTES, type TranscriptReadFs } from "./reader";

let dir: string;

async function writeLines(name: string, recs: unknown[]): Promise<string> {
  const path = join(dir, name);
  const text = recs.map((r) => JSON.stringify(r)).join("\n") + (recs.length ? "\n" : "");
  await writeFile(path, text, "utf8");
  return path;
}

function makeRec(id: string, text: string) {
  return { uuid: id, type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "page-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("TranscriptBackwardPage", () => {
  it("T1: given file with 7 mapper-non-null records, before:null, limit:3 -> expect records #5,#6,#7 oldest→newest; nextBefore names record #5", async () => {
    const recs = Array.from({length:7}, (_,i) => makeRec("u"+(i+1), "t"+(i+1)));
    const path = await writeLines("p.jsonl", recs);
    const res = await readTranscriptPage({ path, before: null, limit: 3 });
    expect(res.records.map((r:any)=>r.recordId)).toEqual(["u5","u6","u7"]);
    expect(res.nextBefore).toEqual({ epoch: expect.any(String), seq: expect.any(Number), recordId: "u5" });
  });

  it("T2: given same file, before naming record #5, limit:3 -> expect records #2,#3,#4; nextBefore names record #1", async () => {
    const recs = Array.from({length:7}, (_,i) => makeRec("u"+(i+1), "t"+(i+1)));
    const path = await writeLines("p.jsonl", recs);
    const page1 = await readTranscriptPage({ path, before: null, limit: 3 });
    expect(page1.nextBefore?.recordId).toBe("u5");
    const res = await readTranscriptPage({ path, before: page1.nextBefore, limit: 3 });
    expect(res.records.map((r:any)=>r.recordId)).toEqual(["u2","u3","u4"]);
    expect(res.nextBefore?.recordId).toBe("u2");
  });

  it("T3: given same file, before naming record #2, limit:3 -> expect record #1 only; nextBefore null", async () => {
    const recs = Array.from({length:7}, (_,i) => makeRec("u"+(i+1), "t"+(i+1)));
    const path = await writeLines("p.jsonl", recs);
    const page1 = await readTranscriptPage({ path, before: null, limit: 3 });
    const page2 = await readTranscriptPage({ path, before: page1.nextBefore, limit: 3 });
    expect(page2.nextBefore?.recordId).toBe("u2");
    const res = await readTranscriptPage({ path, before: page2.nextBefore, limit: 3 });
    expect(res.records.map((r:any)=>r.recordId)).toEqual(["u1"]);
    expect(res.nextBefore).toBeNull();
  });

  it("T4: given file where every record before the batch is isMeta:true / bookkeeping -> expect non-empty batch with nextBefore null", async () => {
    const recs = [
      { uuid: "m1", type: "user", isMeta: true, message: {} },
      makeRec("u1", "real"),
    ];
    const path = await writeLines("p.jsonl", recs);
    const res = await readTranscriptPage({ path, before: null, limit: 10 });
    expect(res.records.map((r:any)=>r.recordId)).toEqual(["u1"]);
    expect(res.nextBefore).toBeNull();
  });

  it("T5: given file with 0 mapper-non-null records -> expect {records: [], nextBefore: null}", async () => {
    const path = await writeLines("p.jsonl", [{ type: "file-history-snapshot" }]);
    const res = await readTranscriptPage({ path, before: null, limit: 10 });
    expect(res.records).toEqual([]);
    expect(res.nextBefore).toBeNull();
  });

  it("T6: given file containing the same recordId at offsets 3000 and 90000 (the C4 duplicate), before:null, limit:50 -> expect both entries present, each with its own seq", async () => {
    const r = makeRec("dup", "x");
    const path = await writeLines("p.jsonl", [r, {type:"noise"}, r]);
    const res = await readTranscriptPage({ path, before: null, limit: 50 });
    expect(res.records.length).toBe(2);
    expect(res.records[0].recordId).toBe("dup");
    expect(res.records[1].recordId).toBe("dup");
    expect(res.records[0].seq).not.toBe(res.records[1].seq);
  });

  it("T7: given a path that does not exist -> expect {records: [], nextBefore: null}, no throw", async () => {
    const res = await readTranscriptPage({ path: join(dir, "nope.jsonl"), before: null, limit: 10 });
    expect(res.records).toEqual([]);
    expect(res.nextBefore).toBeNull();
  });

  it("T8: given no limit argument -> expect at most 50 records", async () => {
    const recs = Array.from({length:60}, (_,i) => makeRec("u"+i, "t"));
    const path = await writeLines("p.jsonl", recs);
    const res = await readTranscriptPage({ path, before: null });
    expect(res.records.length).toBeLessThanOrEqual(50);
  });

  it("T9: given a file whose mid-file records include a compact_boundary + isCompactSummary pair (C16) -> expect the page spans the boundary with no marker and no break", async () => {
    const recs = [makeRec("u1","a"), {type:"compact_boundary"}, {type:"user", isCompactSummary:true, message:{}}, makeRec("u2","b")];
    const path = await writeLines("p.jsonl", recs);
    const res = await readTranscriptPage({ path, before: null, limit: 10 });
    expect(res.records.map((r:any)=>r.recordId)).toEqual(["u1","u2"]);
  });
});

describe("TranscriptPageCursorGuard", () => {
  async function sevenRecordFile(): Promise<string> {
    return writeLines("p.jsonl", Array.from({ length: 7 }, (_, i) => makeRec("u" + (i + 1), "t" + (i + 1))));
  }

  it("T1: given before naming record #5 in the current epoch -> expect the page ending just before it, labelled with the current epoch", async () => {
    const path = await sevenRecordFile();
    const current = epochOf(path);
    const full = await readTranscriptPage({ path, before: null, limit: 99 });
    const rec5 = full.records.find((r: any) => r.recordId === "u5") as any;
    const res = await readTranscriptPage({
      path,
      before: { epoch: current, seq: rec5.seq as number, recordId: "u5" },
      limit: 3,
    });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u2", "u3", "u4"]);
    expect(res.epoch).toBe(current);
  });

  it("T2: given a cursor from another epoch -> expect the newest page of the current file, epoch === current epoch", async () => {
    const path = await sevenRecordFile();
    const current = epochOf(path);
    const res = await readTranscriptPage({
      path,
      before: { epoch: "deadbeefdeadbeef", seq: 4000, recordId: "u9" },
      limit: 3,
    });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u5", "u6", "u7"]);
    expect(res.epoch).toBe(current);
    expect(current).not.toBe("deadbeefdeadbeef");
  });

  it("T3: given a cursor whose seq now holds a different recordId -> expect the newest page (in-place rewrite guard)", async () => {
    const path = await sevenRecordFile();
    const current = epochOf(path);
    const full = await readTranscriptPage({ path, before: null, limit: 99 });
    const rec3 = full.records.find((r: any) => r.recordId === "u3") as any;
    // The offset is real and still occupied — by u3, not by the u9 the client remembers.
    const res = await readTranscriptPage({
      path,
      before: { epoch: current, seq: rec3.seq as number, recordId: "u9" },
      limit: 3,
    });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u5", "u6", "u7"]);
    expect(res.epoch).toBe(current);
  });

  it("T4: given a cursor whose seq is past EOF -> expect the newest page, no throw", async () => {
    const path = await sevenRecordFile();
    const res = await readTranscriptPage({
      path,
      before: { epoch: epochOf(path), seq: 999999, recordId: "u9" },
      limit: 3,
    });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u5", "u6", "u7"]);
  });

  it("stamps every record with the current epoch so a page and a live chunk agree", async () => {
    const path = await sevenRecordFile();
    const res = await readTranscriptPage({ path, before: null, limit: 3 });
    for (const record of res.records) expect(record.epoch).toBe(epochOf(path));
  });
});

function trackingFs(): { fs: TranscriptReadFs; slices: Array<{ start: number; end: number }> } {
  const slices: Array<{ start: number; end: number }> = [];
  const fs: TranscriptReadFs = {
    size: (path) => defaultTranscriptReadFs.size(path),
    async readSlice(path, start, end) {
      slices.push({ start, end });
      return defaultTranscriptReadFs.readSlice(path, start, end);
    },
  };
  return { fs, slices };
}

function paddedRec(id: string, targetBytes: number) {
  let text = "x";
  let rec = makeRec(id, text);
  while (Buffer.byteLength(JSON.stringify(rec), "utf8") + 1 < targetBytes) {
    text += "y";
    rec = makeRec(id, text);
  }
  return rec;
}

/** Kept by the mapper, but with no uuid/id: nothing can name it in a cursor. */
function anonymousRec(targetBytes: number) {
  let text = "x";
  const build = () => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
  let rec = build();
  while (Buffer.byteLength(JSON.stringify(rec), "utf8") + 1 < targetBytes) {
    text += "y";
    rec = build();
  }
  return rec;
}

function metaRec(id: string, targetBytes: number) {
  let extra = "";
  let rec: Record<string, unknown> = { uuid: id, type: "user", isMeta: true, message: { role: "user", content: extra } };
  while (Buffer.byteLength(JSON.stringify(rec), "utf8") + 1 < targetBytes) {
    extra += "m";
    rec = { uuid: id, type: "user", isMeta: true, message: { role: "user", content: extra } };
  }
  return rec;
}

describe("PageReadsOneWindow", () => {
  it("T2: injected maxBytes bounds every readSlice; page matches the uncapped result", async () => {
    const recs = Array.from({ length: 7 }, (_, i) => makeRec("u" + (i + 1), "t" + (i + 1)));
    const path = await writeLines("p.jsonl", recs);
    const { fs, slices } = trackingFs();
    const windowed = await readTranscriptPage({ path, before: null, maxBytes: 1_000_000, fs });
    const today = await readTranscriptPage({ path, before: null });
    expect(slices.every((c) => c.end - c.start <= 1_000_000)).toBe(true);
    expect(windowed).toEqual(today);
  });

  it("T3: a 250-byte window on a 600-byte file yields only the newest 2 records and a non-null nextBefore", async () => {
    const recs = Array.from({ length: 6 }, (_, i) => paddedRec("u" + (i + 1), 100));
    const path = await writeLines("p.jsonl", recs);
    const res = await readTranscriptPage({ path, before: null, limit: 50, maxBytes: 250 });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u5", "u6"]);
    expect(res.nextBefore).not.toBeNull();
    expect(res.nextBefore?.recordId).toBe("u5");
  });

  it("T4: paging with maxBytes:250 moves strictly backwards from the previous page's oldest", async () => {
    const recs = Array.from({ length: 6 }, (_, i) => paddedRec("u" + (i + 1), 100));
    const path = await writeLines("p.jsonl", recs);
    const first = await readTranscriptPage({ path, before: null, limit: 50, maxBytes: 250 });
    expect(first.nextBefore).not.toBeNull();
    const second = await readTranscriptPage({
      path,
      before: first.nextBefore,
      limit: 50,
      maxBytes: 250,
    });
    expect(second.records.length).toBeGreaterThan(0);
    for (const rec of second.records) {
      expect(rec.seq as number).toBeLessThan(first.nextBefore!.seq);
    }
  });

  it("T5: nextBefore is null only when the window starts at 0 and the page took every item", async () => {
    const recs = Array.from({ length: 3 }, (_, i) => makeRec("u" + (i + 1), "t" + (i + 1)));
    const path = await writeLines("p.jsonl", recs);
    const res = await readTranscriptPage({ path, before: null, limit: 50, maxBytes: 1_000_000 });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u1", "u2", "u3"]);
    expect(res.nextBefore).toBeNull();
  });

  it("T6: a valid before cursor ends the page immediately before that record; probe is at most 256 KiB", async () => {
    const recs = Array.from({ length: 7 }, (_, i) => makeRec("u" + (i + 1), "t" + (i + 1)));
    const path = await writeLines("p.jsonl", recs);
    const current = epochOf(path);
    const full = await readTranscriptPage({ path, before: null, limit: 99 });
    const rec5 = full.records.find((r: any) => r.recordId === "u5") as any;
    const { fs, slices } = trackingFs();
    const res = await readTranscriptPage({
      path,
      before: { epoch: current, seq: rec5.seq as number, recordId: "u5" },
      limit: 3,
      fs,
    });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u2", "u3", "u4"]);
    const probes = slices.filter((c) => c.start === rec5.seq);
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((c) => c.end - c.start <= 256 * 1024)).toBe(true);
  });

  it("T7: in-place rewrite (seq holds a different recordId) degrades to the newest page", async () => {
    const recs = Array.from({ length: 7 }, (_, i) => makeRec("u" + (i + 1), "t" + (i + 1)));
    const path = await writeLines("p.jsonl", recs);
    const current = epochOf(path);
    const full = await readTranscriptPage({ path, before: null, limit: 99 });
    const rec3 = full.records.find((r: any) => r.recordId === "u3") as any;
    const res = await readTranscriptPage({
      path,
      before: { epoch: current, seq: rec3.seq as number, recordId: "u9" },
      limit: 3,
    });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u5", "u6", "u7"]);
    expect(res.epoch).toBe(current);
  });

  it("T8: before.seq past EOF yields the newest page without throwing", async () => {
    const recs = Array.from({ length: 7 }, (_, i) => makeRec("u" + (i + 1), "t" + (i + 1)));
    const path = await writeLines("p.jsonl", recs);
    const res = await readTranscriptPage({
      path,
      before: { epoch: epochOf(path), seq: 999999, recordId: "u9" },
      limit: 3,
    });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u5", "u6", "u7"]);
  });

  it("T9: a cursor from a retired epoch skips the probe and returns the newest page", async () => {
    const recs = Array.from({ length: 7 }, (_, i) => makeRec("u" + (i + 1), "t" + (i + 1)));
    const path = await writeLines("p.jsonl", recs);
    const current = epochOf(path);
    const { fs, slices } = trackingFs();
    const res = await readTranscriptPage({
      path,
      before: { epoch: "deadbeefdeadbeef", seq: 4000, recordId: "u9" },
      limit: 3,
      fs,
    });
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u5", "u6", "u7"]);
    expect(res.epoch).toBe(current);
    expect(slices.every((c) => c.start !== 4000)).toBe(true);
  });

  it("T10: a record larger than the probe budget is still accepted as the cut", async () => {
    const head = [makeRec("u1", "a"), makeRec("u2", "b")];
    const giant = makeRec("giant", "G".repeat(400));
    const tail = [makeRec("u3", "c"), makeRec("u4", "d")];
    const path = await writeLines("p.jsonl", [...head, giant, ...tail]);
    const full = await readTranscriptPage({ path, before: null, limit: 99 });
    const g = full.records.find((r: any) => r.recordId === "giant") as any;
    const res = await readTranscriptPage({
      path,
      before: { epoch: epochOf(path), seq: g.seq as number, recordId: "giant" },
      limit: 50,
      probeBytes: 8,
    });
    expect(res.records.every((r: any) => (r.seq as number) < g.seq)).toBe(true);
    expect(res.records.map((r: any) => r.recordId)).toEqual(["u1", "u2"]);
  });

  it("T11: a trailing window of only bookkeeping hops back to a non-empty page", async () => {
    const older = Array.from({ length: 3 }, (_, i) => paddedRec("u" + (i + 1), 100));
    const metas = Array.from({ length: 4 }, (_, i) => metaRec("m" + i, 80));
    const path = await writeLines("p.jsonl", [...older, ...metas]);
    const { fs, slices } = trackingFs();
    const res = await readTranscriptPage({
      path,
      before: null,
      limit: 50,
      maxBytes: 250,
      fs,
    });
    expect(res.records.length).toBeGreaterThan(0);
    expect(res.nextBefore).not.toBeNull();
    const windowReads = slices.filter((c) => c.end - c.start > 1);
    expect(windowReads.length).toBeLessThanOrEqual(4);
    expect(windowReads.every((c) => c.end - c.start <= 250)).toBe(true);
  });

  it("T12: omitting maxBytes keeps the production signature and applies the 4 MiB default", async () => {
    const recs = Array.from({ length: 3 }, (_, i) => makeRec("u" + (i + 1), "t"));
    const path = await writeLines("p.jsonl", recs);
    const res = await readTranscriptPage({ path, before: null });
    expect(res.records).toHaveLength(3);
    expect(TRANSCRIPT_WINDOW_BYTES).toBe(4 * 1024 * 1024);
  });

  it("T13: a page from a 250-byte window is bounded by that window plus seq/epoch stamps", async () => {
    const recs = Array.from({ length: 6 }, (_, i) => paddedRec("u" + (i + 1), 100));
    const path = await writeLines("p.jsonl", recs);
    const page = await readTranscriptPage({ path, before: null, limit: 50, maxBytes: 250 });
    const bytes = Buffer.byteLength(JSON.stringify(page.records), "utf8");
    expect(page.records.length).toBeLessThanOrEqual(3);
    expect(bytes).toBeLessThan(250 + 128 * page.records.length);
  });

  it("T14: hops exhausted mid-file still hands back a cursor, and the older records stay reachable", async () => {
    // Four 250-byte hops cannot cross 1280 bytes of bookkeeping, so the page
    // comes back empty with the three real records still ahead of it.
    const older = Array.from({ length: 3 }, (_, i) => paddedRec("u" + (i + 1), 100));
    const metas = Array.from({ length: 16 }, (_, i) => metaRec("m" + i, 80));
    const path = await writeLines("p.jsonl", [...older, ...metas]);

    const first = await readTranscriptPage({ path, before: null, limit: 50, maxBytes: 250 });
    expect(first.records).toEqual([]);
    // null here would tell the phone the conversation starts at this page.
    expect(first.nextBefore).not.toBeNull();

    const seen: string[] = [];
    let cursor = first.nextBefore;
    for (let hop = 0; hop < 10 && cursor !== null; hop++) {
      const page = await readTranscriptPage({ path, before: cursor, limit: 50, maxBytes: 250 });
      seen.push(...page.records.map((r: any) => r.recordId as string));
      cursor = page.nextBefore;
    }
    expect(seen).toContain("u3");
    expect(seen).toContain("u1");
  });

  it("T15: a page whose records cannot name themselves hands back the caller's own cursor, never null", async () => {
    const named = [paddedRec("u1", 100), paddedRec("u2", 100)];
    const anonymous = Array.from({ length: 4 }, () => anonymousRec(100));
    const tail = paddedRec("last", 100);
    const path = await writeLines("p.jsonl", [...named, ...anonymous, tail]);
    const current = epochOf(path);
    const full = await readTranscriptPage({ path, before: null, limit: 99 });
    const last = full.records.find((r: any) => r.recordId === "last") as any;
    const before = { epoch: current, seq: last.seq as number, recordId: "last" };

    const res = await readTranscriptPage({ path, before, limit: 50, maxBytes: 250 });

    // Records the mapper keeps but nothing can address: the page is real, and
    // the file head is still 400 bytes further back.
    expect(res.records.length).toBeGreaterThan(0);
    expect(res.records.every((r: any) => r.recordId === undefined)).toBe(true);
    expect(res.nextBefore).toEqual(before);
  });
});
