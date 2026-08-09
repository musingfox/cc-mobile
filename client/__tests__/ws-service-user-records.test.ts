import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

function getInternal() {
  return wsService as unknown as {
    ws: any;
    handleMessage: (m: any) => void;
    lastOptimisticSend: Map<string, Array<{messageId:string; prompt:string; sentAt:number}>>;
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
  afterEach(() => { getInternal().ws = prev; });

  test("T1: given {type:\"user\", message:{role:\"user\", content:\"hello\"}, recordId:\"u1\", seq:10} -> expect 1 message {role:\"user\", content:\"hello\", recordId:\"u1\", seq:10}", () => {
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: "hello" }, recordId: "u1", seq: 10 } });
    const m = useAppStore.getState().sessions.get("s1")!.messages[0];
    expect(m.role).toBe("user");
    expect(m.content).toBe("hello");
    expect(m.recordId).toBe("u1");
    expect(m.seq).toBe(10);
  });

  test("T2: given user tool_result -> 0", () => {
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: [{type:"tool_result"}] }, recordId: "u2", seq: 20 } });
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(0);
  });

  test("T3: command-name -> 0", () => {
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: "<command-name>/c</command-name>" }, recordId: "u3", seq: 30 } });
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(0);
  });

  test("T4: local stdout -> 0", () => {
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: "<local-command-stdout>ok</local-command-stdout>" }, recordId: "u4", seq: 40 } });
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(0);
  });

  test("T5: mixed -> ab", () => {
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: [{type:"text",text:"a"},{type:"tool_result"},{type:"text",text:"b"}] }, recordId: "u5", seq: 50 } });
    expect(useAppStore.getState().sessions.get("s1")!.messages[0].content).toBe("ab");
  });

  test("T6: malformed -> 0 no throw", () => {
    expect(() => getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: {} } })).not.toThrow();
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
  afterEach(() => { getInternal().ws = prev; });

  test("T1: given send \"hello\", then {type:\"user\", ... \"hello \", recordId:\"u1\", seq:70} 2s later -> expect 1", () => {
    wsService.terminalSend("s1", "hello");
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: "hello " }, recordId: "u1", seq: 70 } });
    const msgs = useAppStore.getState().sessions.get("s1")!.messages;
    expect(msgs.length).toBe(1);
    expect(msgs[0].recordId).toBe("u1");
  });

  test("T2: mismatch content -> 2", () => {
    wsService.terminalSend("s1", "hello");
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: "goodbye" }, recordId: "x", seq: 1 } });
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(2);
  });

  test("T3: 301s later -> 2", () => {
    const o = Date.now; let t=0; (Date as any).now=()=>t;
    wsService.terminalSend("s1", "hello");
    t += 301000;
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: "hello" }, recordId: "late", seq: 2 } });
    (Date as any).now = o;
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(2);
  });

  test("T4: two sends + two records -> 2 bubbles (use queue)", () => {
    wsService.terminalSend("s1", "hello");
    wsService.terminalSend("s1", "hello");
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: "hello" }, recordId: "u1", seq: 10 } });
    getInternal().handleMessage({ type: "stream_chunk", sessionId: "s1", chunk: { type: "user", message: { role: "user", content: "hello" }, recordId: "u2", seq: 20 } });
    const us = useAppStore.getState().sessions.get("s1")!.messages.filter(m=>m.role==='user');
    expect(us.length).toBe(2);
    expect(us.map(u=>u.recordId)).toEqual(["u1","u2"]);
  });

  test("T5: busy removes echo (preserve)", () => {
    useAppStore.getState().setActiveSession("s1");
    wsService.terminalSend("s1", "hello");
    getInternal().handleMessage({ type: "error", sessionId: "s1", code: "session_busy", message: "b" });
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(0);
    expect(useAppStore.getState().inputDraft).toContain("hello");
  });
});
