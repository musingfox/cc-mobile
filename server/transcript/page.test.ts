import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptRecordToChunk } from "./records";
import { readTranscriptPage } from "./page";

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
    const full = await readTranscriptPage({ path, before: null, limit: 99 });
    const rec5 = full.records.find((r:any) => r.recordId === "u5");
    const before5 = { epoch: "x", seq: rec5.seq as number, recordId: "u5" };
    const res = await readTranscriptPage({ path, before: before5, limit: 3 });
    expect(res.records.map((r:any)=>r.recordId)).toEqual(["u2","u3","u4"]);
    expect(res.nextBefore?.recordId).toBe("u2");
  });

  it("T3: given same file, before naming record #2, limit:3 -> expect record #1 only; nextBefore null", async () => {
    const recs = Array.from({length:7}, (_,i) => makeRec("u"+(i+1), "t"+(i+1)));
    const path = await writeLines("p.jsonl", recs);
    const full = await readTranscriptPage({ path, before: null, limit: 99 });
    const rec2 = full.records.find((r:any) => r.recordId === "u2");
    const before2 = { epoch: "x", seq: rec2.seq as number, recordId: "u2" };
    const res = await readTranscriptPage({ path, before: before2, limit: 3 });
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
