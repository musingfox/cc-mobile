/**
 * ws-service-transcript-rotated.test.ts — ClearRotationNotice, the phone's half.
 *
 * `transcript_rotated` is the epoch rule applied with no messages: it clears
 * exactly when a chunk from the new file would have, and nowhere else. What it
 * adds is timing — a connected, idle phone clears when the terminal does,
 * instead of when the new file's first chunk happens to arrive.
 *
 * The reload cases are review advisory #1: the retired set has to survive a
 * reload, or a replayed pre-rotation chunk reads as a rotation back to the old
 * conversation.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

function internals() {
  return wsService as unknown as {
    ws: { send: (raw: string) => void } | null;
    handleMessage: (msg: Record<string, unknown>) => void;
  };
}

function chunk(recordId: string, seq: number, epoch: string) {
  return {
    type: "stream_chunk",
    sessionId: "s1",
    chunk: {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: recordId }] },
      recordId,
      seq,
      epoch,
    },
  };
}

function rotated(epoch: unknown) {
  return { type: "transcript_rotated", sessionId: "s1", epoch };
}

function session() {
  const state = useAppStore.getState().sessions.get("s1");
  if (!state) throw new Error("no session s1");
  return state;
}

const recordIds = () => session().messages.map((m) => m.recordId);

let previousWs: ReturnType<typeof internals>["ws"];

beforeEach(() => {
  previousWs = internals().ws;
  internals().ws = { send: () => {} };
  localStorage.clear();
  useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  useAppStore.getState().addSession("s1", "/cwd");
  internals().handleMessage(chunk("a1", 10, "aaaa"));
  internals().handleMessage(chunk("a2", 20, "aaaa"));
});

afterEach(() => {
  internals().ws = previousWs;
  useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  localStorage.clear();
});

describe("ClearRotationNotice — an idle phone", () => {
  test("a notice naming a different file clears the conversation without waiting for a chunk", () => {
    internals().handleMessage(rotated("bbbb"));

    expect(session().messages).toEqual([]);
    expect(session().epoch).toBe("bbbb");
    expect(session().retiredEpochs?.has("aaaa")).toBe(true);
    expect(session().pagingCursor).toBeNull();
  });

  test("a notice naming the file already on screen changes nothing", () => {
    internals().handleMessage(rotated("aaaa"));

    expect(recordIds()).toEqual(["a1", "a2"]);
    expect(session().epoch).toBe("aaaa");
  });

  test.each([
    ["an empty", ""],
    ["a null", null],
    ["a missing", undefined],
  ])("%s epoch never clears", (_label, epoch) => {
    internals().handleMessage(rotated(epoch));

    expect(recordIds()).toEqual(["a1", "a2"]);
    expect(session().epoch).toBe("aaaa");
  });

  test("a notice naming a file this session already left is dropped", () => {
    internals().handleMessage(rotated("bbbb"));
    internals().handleMessage(chunk("b1", 0, "bbbb"));
    internals().handleMessage(rotated("aaaa"));

    expect(recordIds()).toEqual(["b1"]);
    expect(session().epoch).toBe("bbbb");
  });

  test("a session with no epoch yet adopts the new one and keeps its local log", () => {
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/cwd");
    useAppStore
      .getState()
      .addMessage("s1", { id: "local", role: "user", content: "hi", timestamp: 1 });

    internals().handleMessage(rotated("bbbb"));

    expect(session().messages.map((m) => m.id)).toEqual(["local"]);
    expect(session().epoch).toBe("bbbb");
  });

  test("the new conversation's messages still arrive after the clear", () => {
    internals().handleMessage(rotated("bbbb"));
    internals().handleMessage(chunk("b1", 0, "bbbb"));
    internals().handleMessage({ type: "stream_end", sessionId: "s1" });

    expect(recordIds()).toEqual(["b1"]);
  });
});

describe("ClearRotationNotice — after a reload (advisory #1)", () => {
  function reload() {
    useAppStore.getState().persistAllSessions();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().restoreAllSessions();
  }

  test("the retired file is still refused after a reload, so a replayed old chunk cannot bring it back", () => {
    internals().handleMessage(rotated("bbbb"));
    internals().handleMessage(chunk("b1", 0, "bbbb"));
    reload();

    expect(session().epoch).toBe("bbbb");
    expect(session().retiredEpochs?.has("aaaa")).toBe(true);

    internals().handleMessage(chunk("a3", 30, "aaaa"));

    expect(recordIds()).toEqual(["b1"]);
    expect(session().epoch).toBe("bbbb");
  });

  test("a reload before any rotation retires nothing and still merges its own file", () => {
    reload();

    expect([...(session().retiredEpochs ?? [])]).toEqual([]);
    internals().handleMessage(chunk("a3", 30, "aaaa"));
    expect(recordIds()).toEqual(["a1", "a2", "a3"]);
  });
});
