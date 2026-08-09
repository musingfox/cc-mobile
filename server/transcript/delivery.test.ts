/**
 * TranscriptTurnDelivery + TranscriptWorkingTail.
 *
 * Every seam is injected, so these run without a daemon and without touching
 * disk. Records are the probe shapes (`fixtures/probe-session.jsonl`), reduced
 * to what the mapping reads.
 */

import { describe, expect, it } from "bun:test";
import { type ClientSink, createTranscriptDelivery } from "./delivery";
import type { TranscriptCursor } from "./reader";

const PATH = "/home/u/.claude/projects/-p/a21273d4.jsonl";

function assistantText(text: string, uuid: string) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    uuid,
  };
}

const NOISE = { type: "file-history-delta", uuid: "noise-1" };

/** A fake transcript file: records appended between reads, byte-addressed. */
function fakeFile(initial: unknown[] = []) {
  let records = [...initial];
  return {
    append(...more: unknown[]) {
      records = [...records, ...more];
    },
    get size() {
      return records.length;
    },
      read: async ({ cursor }: { path: string; cursor: TranscriptCursor }) => {
      const fresh = records.slice(cursor.byteOffset);
      return {
        records: fresh,
        offsets: [],
        cursor: { byteOffset: records.length, lastUuid: `u${records.length}` },
      };
    },
  };
}

function sinkSpy() {
  const messages: Record<string, unknown>[] = [];
  const sink: ClientSink = (msg) => messages.push(msg);
  return { sink, messages };
}

/** Interval scheduler whose ticks fire only when the test advances. */
function fakeIntervals() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  return {
    setIntervalFn: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearIntervalFn: (handle: unknown) => {
      timers.delete(handle as number);
    },
    get count() {
      return timers.size;
    },
    async advance(ms: number) {
      for (const { fn, ms: period } of [...timers.values()]) {
        for (let elapsed = period; elapsed <= ms; elapsed += period) {
          fn();
          // Let the tick's async stat/read settle before the next one.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    },
  };
}

describe("TranscriptTurnDelivery", () => {
  it("delivers new records as chunks terminated by one stream_end", async () => {
    const file = fakeFile();
    const spy = sinkSpy();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });

    file.append(assistantText("hi", "u1"), assistantText("there", "u2"));
    await delivery.deliverTurn("w3V:p1");

    expect(spy.messages.map((m) => m.type)).toEqual(["stream_chunk", "stream_chunk", "stream_end"]);
    expect(spy.messages.every((m) => m.sessionId === "w3V:p1")).toBe(true);
  });

  it("sends nothing at all when the turn produced no new record", async () => {
    const spy = sinkSpy();
    const file = fakeFile();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });

    await delivery.deliverTurn("w3V:p1");

    expect(spy.messages).toEqual([]);
  });

  it("sends nothing when every new record is non-conversational", async () => {
    const spy = sinkSpy();
    const file = fakeFile();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });

    file.append(NOISE, { type: "file-history-delta", uuid: "noise-2" });
    await delivery.deliverTurn("w3V:p1");

    expect(spy.messages).toEqual([]);
  });

  it("skips the non-renderable records and still terminates the turn", async () => {
    const spy = sinkSpy();
    const file = fakeFile();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });

    file.append(NOISE, assistantText("done", "u2"), { type: "file-history-delta", uuid: "n2" });
    await delivery.deliverTurn("w3V:p1");

    expect(spy.messages.map((m) => m.type)).toEqual(["stream_chunk", "stream_end"]);
  });

  it("delivers into the sink bound last, not the one bound at attach time", async () => {
    const ws1 = sinkSpy();
    const ws2 = sinkSpy();
    let current: ClientSink | undefined = ws1.sink;
    const file = fakeFile();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => current,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });

    await delivery.attach("w3V:p1");
    current = undefined; // ws1 disconnected
    current = ws2.sink; // ws2 reconnected and rebound

    file.append(assistantText("hi", "u1"));
    await delivery.deliverTurn("w3V:p1");

    expect(ws1.messages).toEqual([]);
    expect(ws2.messages.map((m) => m.type)).toEqual(["stream_chunk", "stream_end"]);
  });

  it("still delivers into a sink retained across a disconnect", async () => {
    const retained = sinkSpy();
    const file = fakeFile();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      // The sink outlives the socket: it appends to the event buffer.
      getSink: () => retained.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });

    file.append(assistantText("hi", "u1"));
    await delivery.deliverTurn("w3V:p1");

    expect(retained.messages.map((m) => m.type)).toEqual(["stream_chunk", "stream_end"]);
  });

  it("drops the records of a session no client ever bound, and does not re-deliver them", async () => {
    const file = fakeFile();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => undefined,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });

    file.append(assistantText("hi", "u1"), assistantText("there", "u2"));
    await delivery.deliverTurn("w3V:p1");
    expect(delivery.cursorFor("w3V:p1")?.byteOffset).toBe(2);

    // A later settle must not resurrect them, even once a sink exists.
    const spy = sinkSpy();
    const delivery2 = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 2, lastUuid: "u2" }),
    });
    await delivery2.deliverTurn("w3V:p1");
    expect(spy.messages).toEqual([]);
  });

  it("sends nothing and does not throw when the transcript cannot be located", async () => {
    const spy = sinkSpy();
    let reads = 0;
    const delivery = createTranscriptDelivery({
      resolvePath: async () => null,
      getSink: () => spy.sink,
      read: async () => {
        reads++;
        return { records: [], cursor: { byteOffset: 0, lastUuid: null } };
      },
    });

    await delivery.deliverTurn("w3V:p1");

    expect(spy.messages).toEqual([]);
    expect(reads).toBe(0);
  });

  it("attaches at end of file, so the backlog before attach is never delivered", async () => {
    const spy = sinkSpy();
    const file = fakeFile([assistantText("old", "u0")]);
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: file.size, lastUuid: "u1" }),
    });

    await delivery.attach("w3V:p1");
    await delivery.deliverTurn("w3V:p1");

    expect(spy.messages).toEqual([]);
  });
});

describe("TranscriptWorkingTail", () => {
  it("stats every tick and reads nothing while the file has not grown", async () => {
    const spy = sinkSpy();
    const file = fakeFile();
    let stats = 0;
    let reads = 0;
    const clock = fakeIntervals();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: async (input) => {
        reads++;
        return file.read(input);
      },
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
      stat: async () => {
        stats++;
        return file.size;
      },
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    await delivery.onStatus("w3V:p1", "working");
    await clock.advance(3_000);

    expect(stats).toBe(3);
    expect(reads).toBe(0);
    expect(spy.messages).toEqual([]);
  });

  it("emits chunks without an end marker when the file grows mid-turn", async () => {
    const spy = sinkSpy();
    const file = fakeFile();
    let reads = 0;
    const clock = fakeIntervals();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: async (input) => {
        reads++;
        return file.read(input);
      },
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
      stat: async () => file.size,
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    await delivery.onStatus("w3V:p1", "working");
    await clock.advance(1_000);
    file.append(assistantText("partial", "u1"));
    await clock.advance(1_000);

    expect(reads).toBe(1);
    expect(spy.messages.map((m) => m.type)).toEqual(["stream_chunk"]);
  });

  it("delivers each record exactly once across a tail read and the settle", async () => {
    const spy = sinkSpy();
    const file = fakeFile();
    const clock = fakeIntervals();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
      stat: async () => file.size,
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    await delivery.onStatus("w3V:p1", "working");
    file.append(assistantText("first", "u1"));
    await clock.advance(1_000);
    file.append(assistantText("second", "u2"));
    await delivery.onStatus("w3V:p1", "done");
    await delivery.deliverTurn("w3V:p1");

    const texts = spy.messages
      .filter((m) => m.type === "stream_chunk")
      .map(
        (m) =>
          (m.chunk as { message: { content: { text: string }[] } }).message.content[0]?.text ?? "",
      );
    expect(texts).toEqual(["first", "second"]);
    expect(spy.messages.filter((m) => m.type === "stream_end")).toHaveLength(1);
  });

  it("builds one state when attach and the tail race on a pane's first event", async () => {
    // One `pane.updated` carries the session id and the status together, so both
    // handlers reach the delivery module at the same moment for an unseen pane.
    // Two states would mean a tail timer nothing can stop.
    const file = fakeFile();
    let resolveCalls = 0;
    let stats = 0;
    const clock = fakeIntervals();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => {
        resolveCalls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return PATH;
      },
      getSink: () => undefined,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
      stat: async () => {
        stats++;
        return file.size;
      },
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    await Promise.all([delivery.attach("w3V:p1"), delivery.onStatus("w3V:p1", "working")]);
    await delivery.onStatus("w3V:p1", "done");
    await clock.advance(10_000);

    expect(resolveCalls).toBe(1);
    expect(clock.count).toBe(0);
    expect(stats).toBe(0);
  });

  it("still reads the rest of the turn when the settle lands mid tail-read", async () => {
    const spy = sinkSpy();
    const file = fakeFile();
    let reads = 0;
    const clock = fakeIntervals();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: async (input) => {
        reads++;
        // The first read is slow enough for the settle to arrive during it.
        if (reads === 1) await new Promise((resolve) => setTimeout(resolve, 10));
        return file.read(input);
      },
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
      stat: async () => file.size,
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    await delivery.onStatus("w3V:p1", "working");
    file.append(assistantText("first", "u1"));
    const tail = clock.advance(1_000);
    file.append(assistantText("second", "u2"));
    const settle = delivery.deliverTurn("w3V:p1");
    await Promise.all([tail, settle]);

    const texts = spy.messages
      .filter((m) => m.type === "stream_chunk")
      .map(
        (m) =>
          (m.chunk as { message: { content: { text: string }[] } }).message.content[0]?.text ?? "",
      );
    // Each record once, in order, and the turn is terminated exactly once — a
    // settle that skipped its read would drop the end marker, leaving the phone
    // waiting on a turn that finished.
    expect(texts).toEqual(["first", "second"]);
    expect(spy.messages.filter((m) => m.type === "stream_end")).toHaveLength(1);
  });

  it("closes a turn the tail streamed in full, without repeating its chunks", async () => {
    const spy = sinkSpy();
    const file = fakeFile();
    const clock = fakeIntervals();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
      stat: async () => file.size,
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    await delivery.onStatus("w3V:p1", "working");
    file.append(assistantText("all of it", "u1"));
    await clock.advance(1_000);
    await delivery.onStatus("w3V:p1", "done");
    await delivery.deliverTurn("w3V:p1");

    expect(spy.messages.map((m) => m.type)).toEqual(["stream_chunk", "stream_end"]);

    // And the next settle, with nothing open and nothing new, stays silent.
    await delivery.deliverTurn("w3V:p1");
    expect(spy.messages.map((m) => m.type)).toEqual(["stream_chunk", "stream_end"]);
  });

  it("stops tailing once the session leaves working", async () => {
    const file = fakeFile();
    let stats = 0;
    const clock = fakeIntervals();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => undefined,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
      stat: async () => {
        stats++;
        return file.size;
      },
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    await delivery.onStatus("w3V:p1", "working");
    await delivery.onStatus("w3V:p1", "done");
    await clock.advance(10_000);

    expect(stats).toBe(0);
    expect(clock.count).toBe(0);
  });

  it("keeps two working sessions on independent cursors", async () => {
    const fileA = fakeFile();
    const fileB = fakeFile();
    const a = sinkSpy();
    const b = sinkSpy();
    const clock = fakeIntervals();
    const delivery = createTranscriptDelivery({
      resolvePath: async (sessionId) => (sessionId === "wA:p1" ? "/a.jsonl" : "/b.jsonl"),
      getSink: (sessionId) => (sessionId === "wA:p1" ? a.sink : b.sink),
      read: async (input) => (input.path === "/a.jsonl" ? fileA.read(input) : fileB.read(input)),
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
      stat: async (path) => (path === "/a.jsonl" ? fileA.size : fileB.size),
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    await delivery.onStatus("wA:p1", "working");
    await delivery.onStatus("wB:p1", "working");
    fileA.append(assistantText("only A", "u1"));
    await clock.advance(1_000);

    expect(a.messages).toHaveLength(1);
    expect(b.messages).toEqual([]);
    expect(delivery.cursorFor("wA:p1")?.byteOffset).toBe(1);
    expect(delivery.cursorFor("wB:p1")?.byteOffset).toBe(0);
  });

  it("re-attaches at the new file's end of file when the conversation rotates", async () => {
    const spy = sinkSpy();
    const old = fakeFile([assistantText("old", "u0")]);
    const fresh = fakeFile([assistantText("carried over", "n0")]);
    let path = "/old.jsonl";
    const delivery = createTranscriptDelivery({
      resolvePath: async () => path,
      getSink: () => spy.sink,
      read: async (input) => (input.path === "/old.jsonl" ? old.read(input) : fresh.read(input)),
      initCursor: async (input) => ({
        byteOffset: input.path === "/old.jsonl" ? old.size : fresh.size,
        lastUuid: null,
      }),
    });

    await delivery.attach("w3V:p1");
    path = "/new.jsonl";
    await delivery.resetCursor("w3V:p1");

    expect(delivery.cursorFor("w3V:p1")?.byteOffset).toBe(fresh.size);

    fresh.append(assistantText("after clear", "n1"));
    await delivery.deliverTurn("w3V:p1");

    expect(spy.messages.map((m) => m.type)).toEqual(["stream_chunk", "stream_end"]);
  });
});

describe("TranscriptChunkPositionStamp", () => {
  function offsetAwareFake(initial: Array<{ rec: unknown; off: number }> = []) {
    let items = [...initial];
    return {
      append(...more: Array<{ rec: unknown; off: number }>) {
        items = [...items, ...more];
      },
      read: async ({ cursor }: { path: string; cursor: TranscriptCursor }) => {
        const fresh = items.filter((it) => it.off >= cursor.byteOffset);
        const last = fresh.length ? fresh[fresh.length - 1] : null;
        return {
          records: fresh.map((it) => it.rec),
          offsets: fresh.map((it) => it.off),
          cursor: { byteOffset: last ? last.off + 10 : cursor.byteOffset, lastUuid: last ? "uX" : cursor.lastUuid },
        };
      },
    };
  }

  it("T1: given a fake transcript with two renderable records at offsets 0 and 120, delivered on settle -> expect two stream_chunk sink writes with chunk.seq 0 and 120, both carrying the same non-empty chunk.epoch", async () => {
    const file = offsetAwareFake([
      { rec: assistantText("hi", "u1"), off: 0 },
      { rec: assistantText("there", "u2"), off: 120 },
    ]);
    const spy = sinkSpy();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });
    await delivery.deliverTurn("w3V:p1");

    const chunks = spy.messages.filter((m) => m.type === "stream_chunk").map((m) => m.chunk as any);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].seq).toBe(0);
    expect(chunks[1].seq).toBe(120);
    expect(chunks[0].epoch).toBe(chunks[1].epoch);
    expect(chunks[0].epoch).toMatch(/^[0-9a-f]{16}$/);
    expect(chunks[0].epoch?.length).toBe(16);
  });

  it("T2: given the same session after resetCursor with resolvePath now returning a different path -> expect subsequent chunks carry a different chunk.epoch", async () => {
    let p = "/a.jsonl";
    const fileA = offsetAwareFake([{ rec: assistantText("old", "u1"), off: 0 }]);
    const fileB = offsetAwareFake([{ rec: assistantText("new", "n1"), off: 0 }]);
    const spy = sinkSpy();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => p,
      getSink: () => spy.sink,
      read: async (inp) => (p === "/a.jsonl" ? fileA.read(inp) : fileB.read(inp)),
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });
    await delivery.deliverTurn("s1");
    const e1 = (spy.messages[0].chunk as any).epoch;

    p = "/b.jsonl";
    await delivery.resetCursor("s1");
    spy.messages.length = 0;
    await delivery.deliverTurn("s1");
    const e2 = (spy.messages[0].chunk as any).epoch;
    expect(e2).not.toBe(e1);
  });

  it("T3: given a record with isSidechain:true -> expect no sink write; the cursor still advances", async () => {
    const file = offsetAwareFake([
      { rec: { type: "assistant", isSidechain: true, message: { role: "assistant", content: [] }, uuid: "side" }, off: 0 },
    ]);
    const spy = sinkSpy();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });
    await delivery.deliverTurn("s1");
    expect(spy.messages.length).toBe(0); // no write
    expect(delivery.cursorFor("s1")?.byteOffset).toBeGreaterThan(0);
  });

  it("T4: given a settle that yields no renderable record and no open turn -> expect no stream_end emitted (existing behaviour preserved)", async () => {
    const file = offsetAwareFake([]); // nothing renderable
    const spy = sinkSpy();
    const delivery = createTranscriptDelivery({
      resolvePath: async () => PATH,
      getSink: () => spy.sink,
      read: file.read,
      initCursor: async () => ({ byteOffset: 0, lastUuid: null }),
    });
    await delivery.deliverTurn("s1");
    expect(spy.messages.find((m) => m.type === "stream_end")).toBeUndefined();
  });
});
