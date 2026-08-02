/**
 * TranscriptIncrementalRead + TranscriptCursorInitAtEOF.
 *
 * Runs against real files on disk (the default Bun-backed seam), so the byte
 * arithmetic is exercised rather than mocked. Record shapes come from
 * `fixtures/probe-session.jsonl`, a trimmed transcript in the shapes the
 * 2026-08-02 probe recorded.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCursorAtEof, readTranscriptSince, type TranscriptCursor } from "./reader";

const FIXTURE = join(import.meta.dir, "fixtures", "probe-session.jsonl");

let dir: string;

async function fixtureLines(): Promise<string[]> {
  const text = await Bun.file(FIXTURE).text();
  return text.split("\n").filter((line) => line.trim().length > 0);
}

async function writeTranscript(name: string, lines: string[]): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
  return path;
}

function uuidOf(record: unknown): string | null {
  const value = (record as { uuid?: string }).uuid;
  return typeof value === "string" ? value : null;
}

const START: TranscriptCursor = { byteOffset: 0, lastUuid: null };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccm-transcript-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("TranscriptIncrementalRead", () => {
  it("returns every complete record and a cursor at end of file", async () => {
    const lines = (await fixtureLines()).slice(0, 3);
    const path = await writeTranscript("a.jsonl", lines);

    const { records, cursor } = await readTranscriptSince({ path, cursor: START });

    expect(records).toHaveLength(3);
    expect(cursor.byteOffset).toBe(Bun.file(path).size);
    expect(cursor.lastUuid).toBe(uuidOf(JSON.parse(lines[2] as string)));
  });

  it("returns nothing and an identical cursor when the file has not grown", async () => {
    const lines = (await fixtureLines()).slice(0, 3);
    const path = await writeTranscript("a.jsonl", lines);

    const first = await readTranscriptSince({ path, cursor: START });
    const second = await readTranscriptSince({ path, cursor: first.cursor });

    expect(second.records).toEqual([]);
    expect(second.cursor).toEqual(first.cursor);
  });

  it("returns only the records appended since the cursor", async () => {
    const lines = await fixtureLines();
    const path = await writeTranscript("a.jsonl", lines.slice(0, 5));
    const first = await readTranscriptSince({ path, cursor: START });

    await writeTranscript("a.jsonl", lines.slice(0, 7));
    const second = await readTranscriptSince({ path, cursor: first.cursor });

    expect(first.records).toHaveLength(5);
    expect(second.records).toHaveLength(2);
    expect((second.records[0] as { type: string }).type).toBe("system");
    expect((second.records[1] as { type: string }).type).toBe("ai-title");
  });

  it("keeps reading across a compact_boundary in the same file", async () => {
    const lines = await fixtureLines();
    const boundaryAt = lines.findIndex((line) => line.includes('"compact_boundary"'));
    expect(boundaryAt).toBeGreaterThan(-1);

    const path = await writeTranscript("a.jsonl", lines.slice(0, boundaryAt));
    const first = await readTranscriptSince({ path, cursor: START });

    await writeTranscript("a.jsonl", lines);
    const second = await readTranscriptSince({ path, cursor: first.cursor });

    expect(second.records).toHaveLength(lines.length - boundaryAt);
    expect((second.records[0] as { subtype: string }).subtype).toBe("compact_boundary");
    expect(second.cursor.byteOffset).toBe(Bun.file(path).size);
  });

  it("re-reads from the start when the file is shorter than the cursor", async () => {
    const lines = (await fixtureLines()).slice(0, 2);
    const path = await writeTranscript("a.jsonl", lines);

    const { records, cursor } = await readTranscriptSince({
      path,
      cursor: { byteOffset: 40000, lastUuid: "stale-uuid" },
    });

    expect(records).toHaveLength(2);
    expect(cursor.byteOffset).toBe(Bun.file(path).size);
  });

  it("re-reads from the start when the record at the cursor no longer matches", async () => {
    const lines = (await fixtureLines()).slice(0, 3);
    const path = await writeTranscript("a.jsonl", lines);
    const first = await readTranscriptSince({ path, cursor: START });

    // Same length, different content: the file was rewritten in place.
    const { records } = await readTranscriptSince({
      path,
      cursor: {
        byteOffset: first.cursor.byteOffset,
        lastUuid: "0e0e0e0e-dead-4bee-8fff-000000000000",
      },
    });

    expect(records).toHaveLength(3);
  });

  it("ignores a half-written trailing line and stops at the last newline", async () => {
    const lines = (await fixtureLines()).slice(0, 2);
    const path = join(dir, "a.jsonl");
    await writeFile(path, `${lines.join("\n")}\n{"type":"assist`, "utf8");

    const { records, cursor } = await readTranscriptSince({ path, cursor: START });

    expect(records).toHaveLength(2);
    expect(cursor.byteOffset).toBe(Bun.file(path).size - '{"type":"assist'.length);
    expect(cursor.lastUuid).toBe(uuidOf(JSON.parse(lines[1] as string)));
  });

  it("returns an unchanged cursor for a path that does not exist", async () => {
    const cursor = { byteOffset: 120, lastUuid: "u1" };
    const result = await readTranscriptSince({ path: join(dir, "nope.jsonl"), cursor });

    expect(result.records).toEqual([]);
    expect(result.cursor).toEqual(cursor);
  });

  it("skips a malformed line and returns the valid records around it", async () => {
    const lines = (await fixtureLines()).slice(0, 2);
    const path = await writeTranscript("a.jsonl", [
      lines[0] as string,
      "{not json",
      lines[1] as string,
    ]);

    const { records } = await readTranscriptSince({ path, cursor: START });

    expect(records).toHaveLength(2);
    expect(uuidOf(records[1])).toBe(uuidOf(JSON.parse(lines[1] as string)));
  });

  it("tracks byte offsets, not character offsets, for non-ASCII records", async () => {
    const lines = await fixtureLines();
    const wide = JSON.stringify({
      type: "user",
      message: { role: "user", content: "測試中文與 emoji 🐑" },
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    const path = await writeTranscript("a.jsonl", [wide]);
    const first = await readTranscriptSince({ path, cursor: START });
    expect(first.cursor.byteOffset).toBe(Bun.file(path).size);

    await writeTranscript("a.jsonl", [wide, lines[0] as string]);
    const second = await readTranscriptSince({ path, cursor: first.cursor });

    expect(second.records).toHaveLength(1);
    expect(uuidOf(second.records[0])).toBe(uuidOf(JSON.parse(lines[0] as string)));
  });
});

describe("TranscriptCursorInitAtEOF", () => {
  it("attaches at end of file so a long backlog is never replayed", async () => {
    const lines = await fixtureLines();
    const long: string[] = [];
    while (long.length < 2523) long.push(lines[long.length % lines.length] as string);
    const path = await writeTranscript("big.jsonl", long.slice(0, 2523));

    const cursor = await initCursorAtEof({ path });
    expect(cursor.byteOffset).toBe(Bun.file(path).size);

    const { records } = await readTranscriptSince({ path, cursor });
    expect(records).toEqual([]);
  });

  it("starts at zero for a file that does not exist yet", async () => {
    const cursor = await initCursorAtEof({ path: join(dir, "nope.jsonl") });
    expect(cursor).toEqual({ byteOffset: 0, lastUuid: null });
  });
});
