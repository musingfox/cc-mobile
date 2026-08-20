import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ClientMessage, ServerMessage } from "../../server/protocol";
import { toastService } from "../services/toast-service";
import { CAPABILITIES_REQUEST_TIMEOUT_MS, wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
    handleMessage: (msg: Record<string, unknown>) => void;
    requestCapabilities: (sessionId: string, options?: { refresh?: boolean }) => boolean;
  };
}

function sentFrames(): Record<string, unknown>[] {
  const fake = getInternal().ws as unknown as FakeWebSocket | null;
  if (!fake) return [];
  return fake.send.mock.calls.map((call) => JSON.parse(call[0] as string));
}

describe("CapabilityListApplied", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("w1:p1", "/tmp/a");
    useAppStore.getState().addSession("w1:p2", "/tmp/b");
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  test("T1: a delivered list lands on the session that asked", () => {
    getInternal().handleMessage({
      type: "capabilities_list",
      sessionId: "w1:p1",
      commands: [{ name: "help", description: "H" }],
      agents: [{ name: "Explore" }],
    });
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual({
      status: "ready",
      commands: [{ name: "help", description: "H" }],
      agents: [{ name: "Explore" }],
    });
  });

  test("T2: empty arrays are ready, not loading or unavailable", () => {
    getInternal().handleMessage({
      type: "capabilities_list",
      sessionId: "w1:p1",
      commands: [],
      agents: [],
    });
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual({
      status: "ready",
      commands: [],
      agents: [],
    });
  });

  test("T3: a list for one session does not ready another still loading", () => {
    useAppStore.getState().setSessionCapabilities("w1:p1", { status: "loading", sentAt: 1 });
    useAppStore.getState().setSessionCapabilities("w1:p2", { status: "loading", sentAt: 1 });
    getInternal().handleMessage({
      type: "capabilities_list",
      sessionId: "w1:p2",
      commands: [],
      agents: [],
    });
    expect(useAppStore.getState().sessions.get("w1:p2")?.capabilities).toEqual({
      status: "ready",
      commands: [],
      agents: [],
    });
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual({
      status: "loading",
      sentAt: 1,
    });
  });

  test("T4: a frame for a missing session does not throw or create one", () => {
    const before = useAppStore.getState().sessions.size;
    expect(() =>
      getInternal().handleMessage({
        type: "capabilities_list",
        sessionId: "ghost",
        commands: [],
        agents: [],
      }),
    ).not.toThrow();
    expect(useAppStore.getState().sessions.size).toBe(before);
    expect(useAppStore.getState().sessions.has("ghost")).toBe(false);
  });

  test("T5: argumentHint survives onto the store entry", () => {
    getInternal().handleMessage({
      type: "capabilities_list",
      sessionId: "w1:p1",
      commands: [{ name: "help", description: "H", argumentHint: "<topic>" }],
      agents: [],
    });
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual({
      status: "ready",
      commands: [{ name: "help", description: "H", argumentHint: "<topic>" }],
      agents: [],
    });
  });

  test("T6: the T1 frame conforms to ServerMessage", () => {
    const frame = {
      type: "capabilities_list",
      sessionId: "w1:p1",
      commands: [{ name: "help", description: "H" }],
      agents: [{ name: "Explore" }],
    };
    expect(ServerMessage.safeParse(frame).success).toBe(true);
  });
});


describe("CapabilityRequestIssuedOnPickerOpen", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("w1:p1", "/tmp/a");
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  test("T1: first ask sends one frame and marks loading", () => {
    const ok = getInternal().requestCapabilities("w1:p1");
    expect(ok).toBe(true);
    expect(sentFrames()).toEqual([{ type: "capabilities_request", sessionId: "w1:p1" }]);
    const state = useAppStore.getState().sessions.get("w1:p1")?.capabilities;
    expect(state?.status).toBe("loading");
    if (state?.status === "loading") expect(typeof state.sentAt).toBe("number");
  });

  test("T2: a second call while loading is ignored", () => {
    getInternal().requestCapabilities("w1:p1");
    const ok = getInternal().requestCapabilities("w1:p1");
    expect(ok).toBe(false);
    expect(sentFrames()).toHaveLength(1);
  });

  test("T3: ready does not send again", () => {
    useAppStore.getState().setSessionCapabilities("w1:p1", {
      status: "ready",
      commands: [],
      agents: [],
    });
    const ok = getInternal().requestCapabilities("w1:p1");
    expect(ok).toBe(false);
    expect(sentFrames()).toHaveLength(0);
  });

  test("T4: unavailable may retry", () => {
    useAppStore.getState().setSessionCapabilities("w1:p1", {
      status: "unavailable",
      reason: "unsupported",
    });
    const ok = getInternal().requestCapabilities("w1:p1");
    expect(ok).toBe(true);
    expect(sentFrames()).toHaveLength(1);
  });

  test("T5: refresh:true re-asks a ready session", () => {
    useAppStore.getState().setSessionCapabilities("w1:p1", {
      status: "ready",
      commands: [],
      agents: [],
    });
    const ok = getInternal().requestCapabilities("w1:p1", { refresh: true });
    expect(ok).toBe(true);
    expect(sentFrames()).toEqual([
      { type: "capabilities_request", sessionId: "w1:p1", refresh: true },
    ]);
  });

  test("T6: a missing socket writes failed, never undefined", () => {
    getInternal().ws = null;
    const ok = getInternal().requestCapabilities("w1:p1");
    expect(ok).toBe(false);
    expect(sentFrames()).toHaveLength(0);
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual({
      status: "unavailable",
      reason: "failed",
    });
  });

  test("T7: unknown session sends nothing and creates nothing", () => {
    const ok = getInternal().requestCapabilities("nope");
    expect(ok).toBe(false);
    expect(sentFrames()).toHaveLength(0);
    expect(useAppStore.getState().sessions.has("nope")).toBe(false);
  });

  test("T8: the T1 frame conforms to ClientMessage", () => {
    getInternal().requestCapabilities("w1:p1");
    expect(ClientMessage.safeParse(sentFrames()[0]).success).toBe(true);
  });
});


describe("CapabilityUnavailableApplied", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("w1:p1", "/tmp/a");
    errorSpy = spyOn(toastService, "error").mockImplementation(() => "" as never);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    getInternal().ws = prevWs;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  test("T1: unsupported ends the wait without a toast", () => {
    useAppStore.getState().setSessionCapabilities("w1:p1", { status: "loading", sentAt: 1 });
    getInternal().handleMessage({
      type: "error",
      code: "capabilities_unsupported",
      sessionId: "w1:p1",
    });
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual({
      status: "unavailable",
      reason: "unsupported",
    });
    expect(errorSpy.mock.calls.length).toBe(0);
  });

  test("T2: unavailable maps to failed without a toast", () => {
    getInternal().handleMessage({
      type: "error",
      code: "capabilities_unavailable",
      sessionId: "w1:p1",
    });
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual({
      status: "unavailable",
      reason: "failed",
    });
    expect(errorSpy.mock.calls.length).toBe(0);
  });

  test("T3: an unrelated terminal_error leaves a ready list alone", () => {
    const ready = { status: "ready" as const, commands: [{ name: "h" }], agents: [] };
    useAppStore.getState().setSessionCapabilities("w1:p1", ready);
    getInternal().handleMessage({
      type: "error",
      code: "terminal_error",
      message: "x",
      sessionId: "w1:p1",
    });
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual(ready);
  });

  test("T4: ghost session does not throw or appear", () => {
    const before = useAppStore.getState().sessions.size;
    expect(() =>
      getInternal().handleMessage({
        type: "error",
        code: "capabilities_unsupported",
        sessionId: "ghost",
      }),
    ).not.toThrow();
    expect(useAppStore.getState().sessions.size).toBe(before);
  });
});


describe("CapabilityRequestTimeout", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;
  const pending: Array<{ id: number; fn: () => void; at: number }> = [];
  let nextId = 1;
  let clock = 0;
  let origSet: typeof setTimeout;
  let origClear: typeof clearTimeout;

  function flush(ms: number) {
    clock += ms;
    const due = pending.filter((t) => t.at <= clock);
    for (const t of due) {
      const i = pending.indexOf(t);
      if (i >= 0) pending.splice(i, 1);
      t.fn();
    }
  }

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("w1:p1", "/tmp/a");
    pending.length = 0;
    nextId = 1;
    clock = 0;
    origSet = globalThis.setTimeout;
    origClear = globalThis.clearTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      const id = nextId++;
      pending.push({ id, fn, at: clock + (ms ?? 0) });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
      const i = pending.findIndex((t) => t.id === (id as unknown as number));
      if (i >= 0) pending.splice(i, 1);
    }) as typeof clearTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = origSet;
    globalThis.clearTimeout = origClear;
    getInternal().ws = prevWs;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  test("T1: 45s without a reply is failed", () => {
    getInternal().requestCapabilities("w1:p1");
    flush(CAPABILITIES_REQUEST_TIMEOUT_MS);
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual({
      status: "unavailable",
      reason: "failed",
    });
  });

  test("T2: a list at +1s cancels the deadline", () => {
    getInternal().requestCapabilities("w1:p1");
    flush(1000);
    getInternal().handleMessage({
      type: "capabilities_list",
      sessionId: "w1:p1",
      commands: [{ name: "help" }],
      agents: [],
    });
    flush(60_000);
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities?.status).toBe("ready");
  });

  test("T3: unsupported at +1s is not overwritten by the deadline", () => {
    getInternal().requestCapabilities("w1:p1");
    flush(1000);
    getInternal().handleMessage({
      type: "error",
      code: "capabilities_unsupported",
      sessionId: "w1:p1",
    });
    flush(60_000);
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities).toEqual({
      status: "unavailable",
      reason: "unsupported",
    });
  });

  test("T4: 44s is still loading", () => {
    getInternal().requestCapabilities("w1:p1");
    flush(44_000);
    expect(useAppStore.getState().sessions.get("w1:p1")?.capabilities?.status).toBe("loading");
  });

  test("T5: a removed session is not resurrected", () => {
    getInternal().requestCapabilities("w1:p1");
    useAppStore.getState().removeSession("w1:p1");
    expect(() => flush(CAPABILITIES_REQUEST_TIMEOUT_MS)).not.toThrow();
    expect(useAppStore.getState().sessions.has("w1:p1")).toBe(false);
  });
});
