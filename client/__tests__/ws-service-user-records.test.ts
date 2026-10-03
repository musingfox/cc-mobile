import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

function getInternal() {
  return wsService as unknown as {
    ws: any;
    handleMessage: (m: any) => void;
    lastOptimisticSend: Map<string, Array<{ messageId: string; prompt: string; sentAt: number }>>;
  };
}

describe("UserRecordBubble", () => {
  let prev: any;
  beforeEach(() => {
    prev = getInternal().ws;
    getInternal().ws = { send: () => {} };
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/c");
  });
  afterEach(() => {
    getInternal().ws = prev;
  });

  test('T1: given {type:"user", message:{role:"user", content:"hello"}, recordId:"u1", seq:10} -> expect 1 message {role:"user", content:"hello", recordId:"u1", seq:10}', () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content: "hello" }, recordId: "u1", seq: 10 },
    });
    const m = useAppStore.getState().sessions.get("s1")!.messages[0];
    expect(m.role).toBe("user");
    expect(m.content).toBe("hello");
    expect(m.recordId).toBe("u1");
    expect(m.seq).toBe(10);
  });

  test("T2: given user tool_result -> 0", () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: {
        type: "user",
        message: { role: "user", content: [{ type: "tool_result" }] },
        recordId: "u2",
        seq: 20,
      },
    });
    const msgs = useAppStore.getState().sessions.get("s1")!.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe("tool_result");
  });

  test("T3: command-name -> 0", () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: {
        type: "user",
        message: { role: "user", content: "<command-name>/c</command-name>" },
        recordId: "u3",
        seq: 30,
      },
    });
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(0);
  });

  test("T4: local stdout -> 0", () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: {
        type: "user",
        message: { role: "user", content: "<local-command-stdout>ok</local-command-stdout>" },
        recordId: "u4",
        seq: 40,
      },
    });
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(0);
  });

  test("T5: mixed -> ab", () => {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "a" },
            { type: "tool_result" },
            { type: "text", text: "b" },
          ],
        },
        recordId: "u5",
        seq: 50,
      },
    });
    expect(useAppStore.getState().sessions.get("s1")!.messages[0].content).toBe("ab");
  });

  test("T6: malformed -> 0 no throw", () => {
    expect(() =>
      getInternal().handleMessage({
        type: "stream_chunk",
        sessionId: "s1",
        chunk: { type: "user", message: {} },
      }),
    ).not.toThrow();
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(0);
  });
});

describe("OptimisticEchoSupersede", () => {
  let prev: any;
  beforeEach(() => {
    prev = getInternal().ws;
    getInternal().ws = { send: () => {} };
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/c");
  });
  afterEach(() => {
    getInternal().ws = prev;
  });

  test('T1: given send "hello", then {type:"user", ... "hello ", recordId:"u1", seq:70} 2s later -> expect 1', () => {
    wsService.terminalSend("s1", "hello");
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: {
        type: "user",
        message: { role: "user", content: "hello " },
        recordId: "u1",
        seq: 70,
      },
    });
    const msgs = useAppStore.getState().sessions.get("s1")!.messages;
    expect(msgs.length).toBe(1);
    expect(msgs[0].recordId).toBe("u1");
  });

  test("T2: mismatch content -> 2", () => {
    wsService.terminalSend("s1", "hello");
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content: "goodbye" }, recordId: "x", seq: 1 },
    });
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(2);
  });

  test("T3: 301s later -> 2", () => {
    const o = Date.now;
    let t = 0;
    (Date as any).now = () => t;
    try {
      wsService.terminalSend("s1", "hello");
      t += 301000;
      getInternal().handleMessage({
        type: "stream_chunk",
        sessionId: "s1",
        chunk: {
          type: "user",
          message: { role: "user", content: "hello" },
          recordId: "late",
          seq: 2,
        },
      });
    } finally {
      (Date as any).now = o;
    }
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(2);
  });

  test("T4: two sends + two records -> 2 bubbles (use queue)", () => {
    wsService.terminalSend("s1", "hello");
    wsService.terminalSend("s1", "hello");
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content: "hello" }, recordId: "u1", seq: 10 },
    });
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content: "hello" }, recordId: "u2", seq: 20 },
    });
    const us = useAppStore
      .getState()
      .sessions.get("s1")!
      .messages.filter((m) => m.role === "user");
    expect(us.length).toBe(2);
    expect(us.map((u) => u.recordId)).toEqual(["u1", "u2"]);
  });

  test("T5: busy removes echo (preserve)", () => {
    useAppStore.getState().setActiveSession("s1");
    wsService.terminalSend("s1", "hello");
    getInternal().handleMessage({
      type: "error",
      sessionId: "s1",
      code: "session_busy",
      message: "b",
    });
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(0);
    expect(useAppStore.getState().inputDraft).toContain("hello");
  });
});

// Review advisory #3: a prompt typed at the terminal reaches the phone as a
// `user` record. Whether the agent is working is session_state's to say, and a
// chunk-driven `true` that lands after an authoritative idle would contradict
// it, so a user record must not touch the flag at all.
describe("TerminalPromptLeavesStreamingAlone", () => {
  let prev: any;
  beforeEach(() => {
    prev = getInternal().ws;
    getInternal().ws = { send: () => {} };
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/c");
  });
  afterEach(() => {
    getInternal().ws = prev;
  });

  const typed = {
    type: "stream_chunk",
    sessionId: "s1",
    chunk: {
      type: "user",
      message: { role: "user", content: "typed at the terminal" },
      recordId: "t1",
      seq: 5,
      epoch: "aaaa",
    },
  };

  test("a prompt typed at the terminal is shown without raising the streaming flag", () => {
    getInternal().handleMessage(typed);
    const session = useAppStore.getState().sessions.get("s1")!;
    expect(session.messages.map((m) => m.recordId)).toEqual(["t1"]);
    expect(session.isStreaming).toBe(false);
  });

  test("nor does it raise the flag again after session_state has said idle", () => {
    getInternal().handleMessage({ type: "session_state", sessionId: "s1", state: "running" });
    getInternal().handleMessage({ type: "session_state", sessionId: "s1", state: "idle" });
    getInternal().handleMessage(typed);
    getInternal().handleMessage({ type: "stream_end", sessionId: "s1" });
    expect(useAppStore.getState().sessions.get("s1")!.isStreaming).toBe(false);
  });
});

// The same ruling for the reply. The server announces idle before its settle
// read delivers the turn's last records and stream_end, so this order is every
// ordinary turn, not a race.
describe("ReplyAfterIdleLeavesStreamingAlone", () => {
  let prev: any;
  beforeEach(() => {
    prev = getInternal().ws;
    getInternal().ws = { send: () => {} };
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/c");
  });
  afterEach(() => {
    getInternal().ws = prev;
  });

  test("running, idle, a late assistant record, stream_end: the spinner is down", () => {
    getInternal().handleMessage({ type: "session_state", sessionId: "s1", state: "running" });
    getInternal().handleMessage({ type: "session_state", sessionId: "s1", state: "idle" });
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
        recordId: "a1",
        seq: 9,
        epoch: "aaaa",
      },
    });
    getInternal().handleMessage({ type: "stream_end", sessionId: "s1" });
    const session = useAppStore.getState().sessions.get("s1")!;
    expect(session.messages.map((m) => m.recordId)).toEqual(["a1"]);
    expect(session.isStreaming).toBe(false);
  });
});

// Review advisory #6: a send whose record never pairs (the agent rewrote the
// text, or no record came) used to stay in lastOptimisticSend until the tab
// closed. Entries past the pairing window are dropped where paired ones are.
describe("OptimisticSendPruning", () => {
  let prev: any;
  let realNow: () => number;
  let clock = 0;
  beforeEach(() => {
    prev = getInternal().ws;
    getInternal().ws = { send: () => {} };
    getInternal().lastOptimisticSend.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/c");
    realNow = Date.now;
    clock = 1_000_000;
    Date.now = () => clock;
  });
  afterEach(() => {
    Date.now = realNow;
    getInternal().ws = prev;
    getInternal().lastOptimisticSend.clear();
  });

  function userRecord(content: string, recordId: string) {
    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "user", message: { role: "user", content }, recordId, seq: 1 },
    });
  }

  const pendingPrompts = () =>
    getInternal()
      .lastOptimisticSend.get("s1")
      ?.map((p) => p.prompt);

  test("a user record that pairs with nothing still drops the sends past the window", () => {
    wsService.terminalSend("s1", "stale");
    clock += 200_000;
    wsService.terminalSend("s1", "fresh");
    clock += 150_000;

    userRecord("unrelated", "r1");

    expect(pendingPrompts()).toEqual(["fresh"]);
  });

  test("pairing the last live send leaves no entry for the session", () => {
    wsService.terminalSend("s1", "stale");
    clock += 200_000;
    wsService.terminalSend("s1", "fresh");
    clock += 150_000;

    userRecord("fresh", "r1");

    expect(getInternal().lastOptimisticSend.has("s1")).toBe(false);
    const users = useAppStore
      .getState()
      .sessions.get("s1")!
      .messages.filter((m) => m.role === "user");
    // The fresh echo was superseded by its record; the stale one is only
    // forgotten for pairing, and stays on screen as a local-only bubble.
    expect(users.map((m) => m.recordId ?? m.content).sort()).toEqual(["r1", "stale"]);
  });
});
