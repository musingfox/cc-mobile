/**
 * transcript-message-store.test.ts — the store rules that make the session view
 * a projection of one transcript file: TranscriptMessageUpsert,
 * TranscriptMessageOrdering, TranscriptEpochReset, TranscriptEpochAbsenceIgnored
 * and RetiredEpochChunkIgnored.
 *
 * These drive `applyTranscriptMessages` directly. The wiring that feeds it —
 * live chunks, page frames, the reconnect replay — is covered from the
 * ws-service side in `ws-service-transcript-page.test.ts`.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Message, TranscriptCursor } from "../stores/app-store";
import { useAppStore } from "../stores/app-store";

function record(recordId: string, seq: number, content = recordId): Message {
  return { id: `id-${recordId}`, role: "assistant", content, timestamp: 0, recordId, seq };
}

function localOnly(id: string, timestamp: number): Message {
  return { id, role: "user", content: id, timestamp };
}

function session(sessionId = "s1") {
  const state = useAppStore.getState().sessions.get(sessionId);
  if (!state) throw new Error(`no session ${sessionId}`);
  return state;
}

function apply(...args: Parameters<ReturnType<typeof useAppStore.getState>["applyTranscriptMessages"]>) {
  useAppStore.getState().applyTranscriptMessages(...args);
}

beforeEach(() => {
  useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  useAppStore.getState().addSession("s1", "/cwd");
});

describe("TranscriptMessageUpsert", () => {
  test("T1: the same chunk applied twice leaves one message", () => {
    apply("s1", { epoch: "aaaa", messages: [record("u1", 100)] });
    apply("s1", { epoch: "aaaa", messages: [record("u1", 100)] });
    expect(session().messages).toHaveLength(1);
  });

  test("T2: a repeat keeps the earliest position and takes the newer body", () => {
    apply("s1", { epoch: "aaaa", messages: [record("u1", 100, "original")] });
    apply("s1", { epoch: "aaaa", messages: [record("u1", 90000, "edited")] });
    expect(session().messages).toHaveLength(1);
    expect(session().messages[0].seq).toBe(100);
    expect(session().messages[0].content).toBe("edited");
  });

  test("T3: a reconnect replay of five already-applied chunks changes nothing", () => {
    const replay = [record("u1", 10), record("u2", 20), record("u3", 30), record("u4", 40), record("u5", 50)];
    for (const message of replay) apply("s1", { epoch: "aaaa", messages: [message] });
    expect(session().messages).toHaveLength(5);
    for (const message of replay) apply("s1", { epoch: "aaaa", messages: [message] });
    expect(session().messages).toHaveLength(5);
  });

  test("T4: applying the same page twice (the re-open refetch) changes nothing", () => {
    const page = [record("u1", 10), record("u2", 20), record("u3", 30)];
    apply("s1", { epoch: "aaaa", messages: page, nextBefore: null });
    apply("s1", { epoch: "aaaa", messages: page, nextBefore: null });
    expect(session().messages).toHaveLength(3);
  });

  test("T5: two messages with no recordId and identical text stay two messages", () => {
    const text: Message = { id: "a", role: "user", content: "same", timestamp: 1 };
    apply("s1", { epoch: "aaaa", messages: [text] });
    apply("s1", { epoch: "aaaa", messages: [{ ...text, id: "b" }] });
    expect(session().messages).toHaveLength(2);
  });
});

describe("TranscriptMessageOrdering", () => {
  test("T1: out-of-order arrivals render in file order", () => {
    apply("s1", { epoch: "aaaa", messages: [record("c", 300)] });
    apply("s1", { epoch: "aaaa", messages: [record("a", 100)] });
    apply("s1", { epoch: "aaaa", messages: [record("b", 200)] });
    expect(session().messages.map((m) => m.seq)).toEqual([100, 200, 300]);
  });

  test("T2: a message with no seq sorts below every positioned one", () => {
    apply("s1", { epoch: "aaaa", messages: [record("c", 300)] });
    apply("s1", { epoch: "aaaa", messages: [localOnly("echo", 5)] });
    apply("s1", { epoch: "aaaa", messages: [record("a", 100)] });
    expect(session().messages.map((m) => m.id)).toEqual(["id-a", "id-c", "echo"]);
  });

  test("T3: order follows seq even when the timestamps are inverted by 2.2 days", () => {
    const inverted = 2.2 * 24 * 60 * 60 * 1000;
    const later = { ...record("first", 100), timestamp: Date.now() };
    const earlier = { ...record("second", 200), timestamp: Date.now() - inverted };
    apply("s1", { epoch: "aaaa", messages: [later, earlier] });
    expect(session().messages.map((m) => m.recordId)).toEqual(["first", "second"]);
    expect(session().messages[0].timestamp).toBeGreaterThan(session().messages[1].timestamp);
  });

  test("T4: identical millisecond timestamps are broken by seq", () => {
    const tied = 1_700_000_000_000;
    apply("s1", {
      epoch: "aaaa",
      messages: [
        { ...record("b", 80), timestamp: tied },
        { ...record("a", 40), timestamp: tied },
      ],
    });
    expect(session().messages.map((m) => m.seq)).toEqual([40, 80]);
  });
});

describe("TranscriptEpochReset", () => {
  test("T1: a chunk from a different file replaces the whole conversation", () => {
    apply("s1", { epoch: "aaaa", messages: [record("a", 10), record("b", 20), record("c", 30), record("d", 40)] });
    expect(session().messages).toHaveLength(4);
    apply("s1", { epoch: "bbbb", messages: [record("n1", 0)] });
    expect(session().messages).toHaveLength(1);
    expect(session().epoch).toBe("bbbb");
  });

  test("T2: a page from a different file replaces the whole conversation", () => {
    apply("s1", { epoch: "aaaa", messages: [record("a", 10), record("b", 20)] });
    apply("s1", {
      epoch: "bbbb",
      messages: [record("n1", 0), record("n2", 10), record("n3", 20)],
      nextBefore: null,
    });
    expect(session().messages).toHaveLength(3);
  });

  test("T3: a page's nextBefore becomes the session's paging cursor", () => {
    const cursor: TranscriptCursor = { epoch: "bbbb", seq: 400, recordId: "u9" };
    apply("s1", { epoch: "aaaa", messages: [record("a", 10)] });
    apply("s1", { epoch: "bbbb", messages: [record("n1", 500)], nextBefore: cursor });
    expect(session().pagingCursor).toEqual(cursor);
  });

  test("T4: a later reset clears the stored paging cursor", () => {
    apply("s1", {
      epoch: "bbbb",
      messages: [record("n1", 500)],
      nextBefore: { epoch: "bbbb", seq: 400, recordId: "u9" },
    });
    apply("s1", { epoch: "cccc", messages: [record("m1", 0)] });
    expect(session().pagingCursor).toBeNull();
  });

  test("T5: adopting a first epoch keeps the restored local-only messages", () => {
    apply("s1", { messages: [localOnly("l1", 1), localOnly("l2", 2)] });
    apply("s1", { epoch: "aaaa", messages: [record("n1", 0)] });
    expect(session().messages).toHaveLength(3);
    expect(session().epoch).toBe("aaaa");
  });

  test("T6: a chunk from the session's current file resets nothing", () => {
    apply("s1", { epoch: "aaaa", messages: [record("a", 10), record("b", 20)] });
    apply("s1", { epoch: "aaaa", messages: [record("c", 30)] });
    expect(session().messages).toHaveLength(3);
  });
});

describe("TranscriptEpochAbsenceIgnored", () => {
  function withFourMessagesOnAaaa() {
    apply("s1", {
      epoch: "aaaa",
      messages: [record("a", 10), record("b", 20), record("c", 30), record("d", 40)],
    });
  }

  test("T1: null → value adopts the epoch and keeps what is on screen", () => {
    apply("s1", { messages: [localOnly("l1", 1)] });
    apply("s1", { epoch: "aaaa", messages: [record("n1", 0)] });
    expect(session().messages).toHaveLength(2);
    expect(session().epoch).toBe("aaaa");
    expect(session().retiredEpochs?.size ?? 0).toBe(0);
  });

  test("T2: value → null keeps the messages, the epoch, and retires nothing", () => {
    withFourMessagesOnAaaa();
    apply("s1", { epoch: null, messages: [] });
    expect(session().messages).toHaveLength(4);
    expect(session().epoch).toBe("aaaa");
    expect(session().retiredEpochs?.has("aaaa") ?? false).toBe(false);
  });

  test("T3: value → absent is indistinguishable from value → null", () => {
    withFourMessagesOnAaaa();
    apply("s1", { epoch: null, messages: [] });
    const afterNull = session();

    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/cwd");
    withFourMessagesOnAaaa();
    apply("s1", { messages: [] });
    const afterAbsent = session();

    expect(afterAbsent.messages).toEqual(afterNull.messages);
    expect(afterAbsent.epoch).toBe(afterNull.epoch);
    expect(afterAbsent.retiredEpochs?.size ?? 0).toBe(afterNull.retiredEpochs?.size ?? 0);
  });

  test("T4: an empty-string epoch never wipes", () => {
    withFourMessagesOnAaaa();
    apply("s1", { epoch: "", messages: [] });
    expect(session().messages).toHaveLength(4);
    expect(session().epoch).toBe("aaaa");
  });

  test("T5: the same epoch merges by recordId instead of wiping", () => {
    withFourMessagesOnAaaa();
    apply("s1", { epoch: "aaaa", messages: [record("a", 10, "edited")] });
    expect(session().messages).toHaveLength(4);
    expect(session().messages[0].content).toBe("edited");
  });

  test("T6: a different epoch is the one case that wipes", () => {
    withFourMessagesOnAaaa();
    apply("s1", { epoch: "bbbb", messages: [record("n1", 0)] });
    expect(session().messages).toHaveLength(1);
  });

  test("T7: a delivery that carries nothing at all leaves the session untouched", () => {
    withFourMessagesOnAaaa();
    // What ws-service does on a transcript_unavailable reply: nothing.
    expect(session().messages).toHaveLength(4);
    expect(session().epoch).toBe("aaaa");
  });
});

describe("RetiredEpochChunkIgnored", () => {
  test("T1: a replayed pre-reset chunk cannot drag the session back", () => {
    apply("s1", { epoch: "aaaa", messages: [record("r1", 1)] });
    apply("s1", { epoch: "bbbb", messages: [record("r2", 0)] });
    apply("s1", { epoch: "aaaa", messages: [record("r3", 2)] });
    expect(session().messages).toHaveLength(1);
    expect(session().epoch).toBe("bbbb");
  });

  test("T2: an epoch left two resets ago is still retired", () => {
    apply("s1", { epoch: "aaaa", messages: [record("r1", 1)] });
    apply("s1", { epoch: "bbbb", messages: [record("r2", 1)] });
    apply("s1", { epoch: "cccc", messages: [record("r3", 1)] });
    apply("s1", { epoch: "bbbb", messages: [record("r4", 2)] });
    expect(session().messages.map((m) => m.recordId)).toEqual(["r3"]);
    expect(session().epoch).toBe("cccc");
  });

  test("T3: an epoch never seen before is a reset, not a drop", () => {
    apply("s1", { epoch: "aaaa", messages: [record("r1", 1)] });
    apply("s1", { epoch: "zzzz", messages: [record("r2", 0)] });
    expect(session().messages.map((m) => m.recordId)).toEqual(["r2"]);
    expect(session().epoch).toBe("zzzz");
  });
});

describe("LocalOnlyDiscardOnFirstPage — the store's half", () => {
  test("T1: local-only messages older than the request give way to the page", () => {
    apply("s1", { messages: [localOnly("l1", 1), localOnly("l2", 2), localOnly("l3", 3)] });
    apply("s1", {
      epoch: "aaaa",
      messages: [record("a", 10), record("b", 20)],
      nextBefore: null,
      discardLocalBefore: 100,
    });
    expect(session().messages.map((m) => m.recordId)).toEqual(["a", "b"]);
  });

  test("T2: an echo created after the request went out survives", () => {
    apply("s1", { messages: [localOnly("restored", 1)] });
    apply("s1", { messages: [localOnly("typing", 200)] });
    apply("s1", {
      epoch: "aaaa",
      messages: [record("a", 10)],
      nextBefore: null,
      discardLocalBefore: 100,
    });
    expect(session().messages.map((m) => m.id)).toEqual(["id-a", "typing"]);
  });

  test("T4: a page for a session with no local-only messages discards nothing", () => {
    apply("s1", { epoch: "aaaa", messages: [record("a", 10)] });
    apply("s1", {
      epoch: "aaaa",
      messages: [record("b", 20)],
      nextBefore: null,
      discardLocalBefore: Date.now(),
    });
    expect(session().messages.map((m) => m.recordId)).toEqual(["a", "b"]);
  });
});
