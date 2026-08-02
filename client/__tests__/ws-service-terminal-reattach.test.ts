import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getAllSessionIds, saveSessionState } from "../services/session-persistence";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * ClientSessionRekey (list half) — on reconnect the client asks the server which
 * claude sessions are alive anywhere on the machine and converges every card to
 * that answer: listed ones become ready again (curing the permanent ready:false
 * after a reload), absent ones leave the list with a single toast, creates still
 * in flight are left alone until their `terminal_created` arrives, and a session
 * the user started in their own terminal gets a card this browser has never
 * seen.
 *
 * The list is keyed by herdr's pane id (Decision H5) and carries per-session
 * capability flags; `unknownUuids` went with the startup remount scan that
 * produced it (Decision M12), so "skipped, leave alone" no longer exists.
 */

/** One entry of the server's `terminal_sessions.sessions` array. */
function descriptor(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    agentSessionValue: `value-${sessionId}`,
    cwd: "/tmp",
    origin: "self",
    drivable: true,
    readable: true,
    gated: true,
    ...overrides,
  };
}

/** A `terminal_sessions` reply listing exactly these session ids. */
function listing(ids: string[], overrides: Record<string, Record<string, unknown>> = {}) {
  const sessions = ids.map((id) => descriptor(id, overrides[id] ?? {}));
  return {
    type: "terminal_sessions",
    sessions,
    claudeUuids: sessions.map((entry) => entry.sessionId),
  };
}

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

    getInternal().handleMessage(listing(["u1"]));

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

    getInternal().handleMessage(listing([]));

    expect(useAppStore.getState().sessions.has("u2")).toBe(false);
    expect(getAllSessionIds()).not.toContain("u2");
    expect(localStorage.getItem("ccm:session:u2")).toBeNull();
    expect(infoToast).toHaveBeenCalledTimes(1);
    expect(infoToast).toHaveBeenCalledWith("Terminal session ended");
  });

  test("several dead sessions still produce a single toast", () => {
    useAppStore.getState().addSession("u2a", "/tmp", { ready: true });
    useAppStore.getState().addSession("u2b", "/tmp", { ready: true });

    getInternal().handleMessage(listing([]));

    expect(sessionIds()).toEqual([]);
    expect(infoToast).toHaveBeenCalledTimes(1);
  });

  test("a listed session the browser has never seen gets a card", () => {
    // The user's own terminal session, appearing on the phone for the first time.
    getInternal().handleMessage(
      listing(["w9:p1"], {
        "w9:p1": { origin: "foreign", readable: false, cwd: "/repo" },
      }),
    );

    const session = useAppStore.getState().sessions.get("w9:p1");
    expect(session?.cwd).toBe("/repo");
    expect(session?.descriptor).toEqual({
      origin: "foreign",
      drivable: true,
      readable: false,
      gated: true,
    });
    expect(session?.terminal?.ready).toBe(true);
  });

  test("a new card from the list does not steal the active session", () => {
    // The list arrives on every reconnect; yanking the user out of the
    // conversation they are reading would be worse than not showing the card.
    useAppStore.getState().addSession("u1", "/tmp", { ready: true });

    getInternal().handleMessage(listing(["u1", "w9:p1"]));

    expect(useAppStore.getState().activeSessionId).toBe("u1");
  });

  test("an ungated pane is listed as drivable with the flag intact", () => {
    getInternal().handleMessage(listing(["w4:p1"], { "w4:p1": { gated: false } }));

    const flags = useAppStore.getState().sessions.get("w4:p1")?.descriptor;
    expect(flags?.gated).toBe(false);
    expect(flags?.drivable).toBe(true);
  });

  test("a legacy uuid-keyed card is reconciled away once, with one toast", () => {
    // The documented one-time upgrade loss: cards keyed by claude uuid match no
    // pane id, so they leave on the first listing (Decision H5).
    useAppStore.getState().addSession("3f2a9b01-1111-4222-8333-444455556666", "/tmp", {
      ready: true,
    });

    getInternal().handleMessage(listing([]));

    expect(sessionIds()).toEqual([]);
    expect(infoToast).toHaveBeenCalledTimes(1);
  });

  test("a create still in flight is left alone", () => {
    useAppStore.getState().addSession("u3", "/tmp", { ready: false });
    getInternal().pendingTerminalCreates.add("u3");

    getInternal().handleMessage(listing([]));

    expect(useAppStore.getState().sessions.has("u3")).toBe(true);
    expect(useAppStore.getState().sessions.get("u3")?.terminal?.ready).toBe(false);
    expect(infoToast).not.toHaveBeenCalled();
  });

  test("a markerless ghost is removed too, storage and all", () => {
    // The marker exemption is what let a card herdr never heard of survive
    // every reconnect — the openabc symptom. herdr's answer now governs every
    // session in the store, marker or not.
    useAppStore.getState().addSession("u4", "/tmp");
    const persisted = useAppStore.getState().sessions.get("u4");
    if (!persisted) throw new Error("session not added");
    saveSessionState("u4", persisted);
    expect(getAllSessionIds()).toContain("u4");

    getInternal().handleMessage(listing([]));

    expect(useAppStore.getState().sessions.has("u4")).toBe(false);
    expect(localStorage.getItem("ccm:session:u4")).toBeNull();
    expect(getAllSessionIds()).not.toContain("u4");
    expect(infoToast).toHaveBeenCalledTimes(1);
  });

  test("a mixed live list readies every listed session and removes none", () => {
    useAppStore.getState().addSession("u1", "/tmp", { ready: false });
    useAppStore.getState().addSession("u2", "/tmp", { ready: true });

    getInternal().handleMessage(listing(["u2", "u1"]));

    expect(useAppStore.getState().sessions.get("u1")?.terminal?.ready).toBe(true);
    expect(useAppStore.getState().sessions.get("u2")?.terminal?.ready).toBe(true);
    expect(sessionIds()).toEqual(["u1", "u2"]);
    expect(infoToast).not.toHaveBeenCalled();
  });

  test("removing the active session falls back to a session that survived", () => {
    useAppStore.getState().addSession("u1", "/tmp", { ready: false });
    useAppStore.getState().addSession("u2", "/tmp", { ready: true });
    expect(useAppStore.getState().activeSessionId).toBe("u2");

    getInternal().handleMessage(listing(["u1"]));

    expect(useAppStore.getState().activeSessionId).toBe("u1");
  });

  test("when nothing survives there is no active session left", () => {
    useAppStore.getState().addSession("u4", "/tmp");
    useAppStore.getState().setActiveSession("u4");

    getInternal().handleMessage(listing([]));

    expect(sessionIds()).toEqual([]);
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  test("removing the only session leaves no active session", () => {
    useAppStore.getState().addSession("u2", "/tmp", { ready: true });

    getInternal().handleMessage(listing([]));

    expect(sessionIds()).toEqual([]);
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  test("a malformed payload changes nothing", () => {
    useAppStore.getState().addSession("u5", "/tmp", { ready: false });

    getInternal().handleMessage({ type: "terminal_sessions", sessions: "nope" });

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
