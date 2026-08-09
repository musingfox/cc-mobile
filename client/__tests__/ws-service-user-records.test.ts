import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
    handleMessage: (msg: Record<string, unknown>) => void;
  };
}

describe("UserRecordBubble", () => {
  let prevWs: WebSocket | null;

  beforeEach(() => {
    prevWs = getInternal().ws;
    getInternal().ws = { send: () => {} } as any;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
    useAppStore.getState().addSession("s1", "/cwd", { ready: true });
  });

  afterEach(() => {
    getInternal().ws = prevWs;
  });

  test("T1: given send path then user chunk with recordId/seq -> expect 1 user message carrying them", () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content: "hello" }, recordId: "u1", seq: 70 },
    });
    const msgs = useAppStore.getState().sessions.get("s1")?.messages ?? [];
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hello");
    expect(msgs[0].recordId).toBe("u1");
    expect(msgs[0].seq).toBe(70);
  });

  test("T2: given user tool_result chunk -> 0 messages added", () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "…" }] }, recordId: "u2", seq: 20 },
    });
    const msgs = useAppStore.getState().sessions.get("s1")?.messages ?? [];
    expect(msgs.length).toBe(0);
  });

  test("T3: command-name wrapper -> 0 messages", () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content: "<command-name>/clear</command-name>" }, recordId: "u3", seq: 30 },
    });
    expect((useAppStore.getState().sessions.get("s1")?.messages ?? []).length).toBe(0);
  });

  test("T4: local-command-stdout -> 0", () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content: "<local-command-stdout>ok</local-command-stdout>" }, recordId: "u4", seq: 40 },
    });
    expect((useAppStore.getState().sessions.get("s1")?.messages ?? []).length).toBe(0);
  });

  test("T5: mixed text/tool/text -> concat visible", () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content: [{ type: "text", text: "a" }, { type: "tool_result" }, { type: "text", text: "b" }] }, recordId: "u5", seq: 50 },
    });
    const msgs = useAppStore.getState().sessions.get("s1")?.messages ?? [];
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe("ab");
  });

  test("T6: malformed -> 0 no throw", () => {
    expect(() => getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: {} },
    })).not.toThrow();
    expect((useAppStore.getState().sessions.get("s1")?.messages ?? []).length).toBe(0);
  });
});
