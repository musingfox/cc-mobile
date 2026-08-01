import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getAllSessionIds, saveSessionState } from "../services/session-persistence";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * ClientTerminalReattach — on reconnect the client asks the server which
 * terminal sessions are alive and converges every card to that answer: live
 * ones become ready again (curing the permanent ready:false after a reload),
 * dead ones leave the list with a single toast, and creates still in flight are
 * left alone until their `tmux_created` arrives.
 */

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
    handleMessage: (msg: Record<string, unknown>) => void;
    pendingTerminalCreates: Set<string>;
  };
}

function sessionIds() {
  return [...useAppStore.getState().sessions.keys()];
}

describe("wsService terminal reattach reconcile", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;
  const originalToastInfo = toastService.info;
  let infoToast: ReturnType<typeof mock>;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    getInternal().pendingTerminalCreates.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    infoToast = mock((_msg: string): string | number => 0);
    toastService.info = infoToast as typeof toastService.info;
    localStorage.clear();
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    getInternal().pendingTerminalCreates.clear();
    toastService.info = originalToastInfo;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    localStorage.clear();
  });

  test("a live session flips back to ready", () => {
    useAppStore.getState().addSession("u1", "/tmp", { ready: false });

    getInternal().handleMessage({ type: "terminal_sessions", claudeUuids: ["u1"] });

    expect(useAppStore.getState().sessions.get("u1")?.terminal?.ready).toBe(true);
    expect(getInternal().pendingTerminalCreates.has("u1")).toBe(false);
    expect(infoToast).not.toHaveBeenCalled();
  });

  test("a session the server no longer has is removed with one toast", () => {
    useAppStore.getState().addSession("u2", "/tmp", { ready: true });
    // Mirror what the persistence layer writes for a restored card, so the
    // removal can be observed to clear localStorage too.
    const persisted = useAppStore.getState().sessions.get("u2");
    if (!persisted) throw new Error("session not added");
    saveSessionState("u2", persisted);
    expect(getAllSessionIds()).toContain("u2");

    getInternal().handleMessage({ type: "terminal_sessions", claudeUuids: [] });

    expect(useAppStore.getState().sessions.has("u2")).toBe(false);
    expect(getAllSessionIds()).not.toContain("u2");
    expect(localStorage.getItem("ccm:session:u2")).toBeNull();
    expect(infoToast).toHaveBeenCalledTimes(1);
    expect(infoToast).toHaveBeenCalledWith("Terminal session ended");
  });

  test("several dead sessions still produce a single toast", () => {
    useAppStore.getState().addSession("u2a", "/tmp", { ready: true });
    useAppStore.getState().addSession("u2b", "/tmp", { ready: true });

    getInternal().handleMessage({ type: "terminal_sessions", claudeUuids: [] });

    expect(sessionIds()).toEqual([]);
    expect(infoToast).toHaveBeenCalledTimes(1);
  });

  test("a create still in flight is left alone", () => {
    useAppStore.getState().addSession("u3", "/tmp", { ready: false });
    getInternal().pendingTerminalCreates.add("u3");

    getInternal().handleMessage({ type: "terminal_sessions", claudeUuids: [] });

    expect(useAppStore.getState().sessions.has("u3")).toBe(true);
    expect(useAppStore.getState().sessions.get("u3")?.terminal?.ready).toBe(false);
    expect(infoToast).not.toHaveBeenCalled();
  });

  test("SDK sessions carry no terminal marker and are never touched", () => {
    useAppStore.getState().addSession("u4", "/tmp");

    getInternal().handleMessage({ type: "terminal_sessions", claudeUuids: [] });

    expect(useAppStore.getState().sessions.get("u4")).toBeDefined();
    expect(useAppStore.getState().sessions.get("u4")?.terminal).toBeUndefined();
    expect(infoToast).not.toHaveBeenCalled();
  });

  test("a mixed live list readies every listed session and removes none", () => {
    useAppStore.getState().addSession("u1", "/tmp", { ready: false });
    useAppStore.getState().addSession("u2", "/tmp", { ready: true });

    getInternal().handleMessage({ type: "terminal_sessions", claudeUuids: ["u2", "u1"] });

    expect(useAppStore.getState().sessions.get("u1")?.terminal?.ready).toBe(true);
    expect(useAppStore.getState().sessions.get("u2")?.terminal?.ready).toBe(true);
    expect(sessionIds()).toEqual(["u1", "u2"]);
    expect(infoToast).not.toHaveBeenCalled();
  });

  test("removing the active terminal session falls back to a surviving one", () => {
    useAppStore.getState().addSession("u4", "/tmp");
    useAppStore.getState().addSession("u2", "/tmp", { ready: true });
    expect(useAppStore.getState().activeSessionId).toBe("u2");

    getInternal().handleMessage({ type: "terminal_sessions", claudeUuids: [] });

    expect(useAppStore.getState().activeSessionId).toBe("u4");
  });

  test("removing the only session leaves no active session", () => {
    useAppStore.getState().addSession("u2", "/tmp", { ready: true });

    getInternal().handleMessage({ type: "terminal_sessions", claudeUuids: [] });

    expect(sessionIds()).toEqual([]);
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  test("a malformed payload changes nothing", () => {
    useAppStore.getState().addSession("u5", "/tmp", { ready: false });

    getInternal().handleMessage({ type: "terminal_sessions" });

    expect(useAppStore.getState().sessions.has("u5")).toBe(true);
    expect(useAppStore.getState().sessions.get("u5")?.terminal?.ready).toBe(false);
    expect(infoToast).not.toHaveBeenCalled();
  });
});

describe("wsService onopen terminal session query", () => {
  let prevWs: WebSocket | null;
  let prevWebSocketCtor: typeof WebSocket;
  let sent: Record<string, unknown>[];

  function openConnection() {
    sent = [];
    let opened: { onopen?: () => void } | null = null;
    class StubWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: (() => void) | null = null;
      send(data: string) {
        sent.push(JSON.parse(data));
      }
      constructor(_url: string) {
        opened = this as unknown as { onopen?: () => void };
      }
    }
    (globalThis as { WebSocket: unknown }).WebSocket = StubWebSocket;

    wsService.connect();
    (opened as unknown as { onopen: () => void }).onopen();
  }

  beforeEach(() => {
    prevWs = getInternal().ws;
    prevWebSocketCtor = globalThis.WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    (globalThis as { WebSocket: unknown }).WebSocket = prevWebSocketCtor;
    // connect() moves connectionState to "connected"; restore the store default
    // so the connection banner tests stay independent of execution order.
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      connectionState: "connecting",
    });
    localStorage.clear();
  });

  test("onopen sends list_terminal_sessions after the reconnect message", () => {
    useAppStore.getState().addSession("u1", "/tmp", { ready: false });

    openConnection();

    const types = sent.map((m) => m.type);
    expect(types).toContain("list_terminal_sessions");
    expect(types.indexOf("list_terminal_sessions")).toBeGreaterThan(types.indexOf("reconnect"));
    expect(sent[types.indexOf("list_terminal_sessions")]).toEqual({
      type: "list_terminal_sessions",
    });
  });

  test("onopen sends list_terminal_sessions even with no local sessions", () => {
    openConnection();

    const types = sent.map((m) => m.type);
    expect(types).toContain("list_terminal_sessions");
    expect(types).not.toContain("reconnect");
  });
});
