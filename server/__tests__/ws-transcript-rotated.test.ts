/**
 * ws-transcript-rotated.test.ts — ClearRotationNotice, the transport's half.
 *
 * A terminal `/clear` reaches the phone as `transcript_rotated` through the
 * session's buffered sink. Everything buffered before it belongs to the file
 * the terminal cleared, so a reconnect must replay the notice and what came
 * after it — never the cleared conversation, and never a false gap warning.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { WsBackend } from "../ws";
import { startWsHarness, type WsHarness } from "./ws-harness";

type Sink = (msg: Record<string, unknown>) => void;

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const PANE = "w3V:p1";

function chunk(text: string, epoch: string) {
  return {
    type: "stream_chunk",
    sessionId: PANE,
    chunk: { type: "assistant", message: { role: "assistant", content: text }, epoch },
  };
}

/** A harness whose listing binds one pane, with that pane's sink handed back. */
async function boundSink(): Promise<Sink> {
  const sinks = new Map<string, Sink>();
  const backend: Partial<WsBackend> = {
    listLive: () => [PANE],
    registerClient: (sessionId, sink) => {
      sinks.set(sessionId, sink);
    },
    cleanupByOwner: () => {},
  };
  harness = await startWsHarness(backend);
  harness.send({ type: "list_terminal_sessions" });
  await harness.waitFor((msg) => msg.type === "terminal_sessions");
  const sink = sinks.get(PANE);
  if (!sink) throw new Error("listing bound no sink");
  return sink;
}

describe("ClearRotationNotice — replay buffer", () => {
  test("the notice empties the session's buffer and is the first event left in it", async () => {
    const sink = await boundSink();
    sink(chunk("before", "aaaa"));
    sink({ type: "stream_end", sessionId: PANE });
    sink({ type: "transcript_rotated", sessionId: PANE, epoch: "bbbb" });
    sink(chunk("after", "bbbb"));

    const buffered = harness?.eventBuffer.replay(PANE, 0).map((event) => event.message);
    expect(buffered).toEqual([
      { type: "transcript_rotated", sessionId: PANE, epoch: "bbbb" },
      chunk("after", "bbbb"),
    ]);
  });

  test("a phone that left before the clear is replayed the notice onward, with no gap warning", async () => {
    const sink = await boundSink();
    sink(chunk("before", "aaaa"));
    sink(chunk("still before", "aaaa"));
    sink({ type: "transcript_rotated", sessionId: PANE, epoch: "bbbb" });
    sink(chunk("after", "bbbb"));
    await harness?.waitFor((msg) => msg.type === "event" && msg.eventId === 4);
    const before = harness?.received.length ?? 0;

    // This phone saw only the first event before its socket dropped.
    harness?.send({
      type: "reconnect",
      lastEventId: null,
      lastEventIds: { [PANE]: 1 },
      sessionIds: [PANE],
    });
    const done = await harness?.waitFor((msg) => msg.type === "replay_complete");

    const replayed = (harness?.received.slice(before) ?? [])
      .filter((msg) => msg.type === "event")
      .map((msg) => msg.payload);
    expect(replayed).toEqual([
      { type: "transcript_rotated", sessionId: PANE, epoch: "bbbb" },
      chunk("after", "bbbb"),
    ]);
    expect(done).toMatchObject({ eventsReplayed: 2, gapDetected: false });
  });
});
