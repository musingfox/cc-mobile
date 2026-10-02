import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ClientMessage } from "../../server/protocol";
import { FOREGROUND_FRESH_MS } from "../../server/push/foreground";
import { VISIBILITY_HEARTBEAT_MS, wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * The page tells the server whether it is on screen — on connect, on every
 * change, and again on a heartbeat while visible — so the server can hold back
 * a push to a phone that is already showing cc-mobile.
 */

interface Internal {
  ws: WebSocket | null;
  socket: WebSocket | null;
  reconnectTimeout: number | null;
  disconnectBannerTimeout: number | null;
}

function internal() {
  return wsService as unknown as Internal;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("wsService visibility reporting", () => {
  let prevWs: WebSocket | null;
  let prevCtor: typeof WebSocket;
  let prevSetInterval: typeof window.setInterval;
  let prevClearInterval: typeof window.clearInterval;
  let sent: Record<string, unknown>[];
  let socket: { onopen: () => void; onclose: () => void };
  let heartbeat: { fn: () => void; ms: number } | null;
  let cleared: unknown[];

  function open() {
    class StubWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: (() => void) | null = null;
      send(data: string) {
        sent.push(JSON.parse(data));
      }
      constructor(_url: string) {
        socket = this as unknown as typeof socket;
      }
    }
    (globalThis as { WebSocket: unknown }).WebSocket = StubWebSocket;
    wsService.connect();
    socket.onopen();
  }

  const visibilityFrames = () => sent.filter((msg) => msg.type === "visibility");

  beforeEach(() => {
    sent = [];
    heartbeat = null;
    cleared = [];
    prevWs = internal().ws;
    prevCtor = globalThis.WebSocket;
    prevSetInterval = window.setInterval;
    prevClearInterval = window.clearInterval;
    window.setInterval = ((fn: () => void, ms: number) => {
      heartbeat = { fn, ms };
      return 41;
    }) as unknown as typeof window.setInterval;
    window.clearInterval = ((id: unknown) => {
      cleared.push(id);
    }) as typeof window.clearInterval;
    setVisibility("visible");
  });

  afterEach(() => {
    internal().ws = prevWs;
    // connect() is a no-op while its last socket is still opening; this stub
    // never closes, so the next test's connect would otherwise open nothing.
    internal().socket = null;
    (globalThis as { WebSocket: unknown }).WebSocket = prevCtor;
    window.setInterval = prevSetInterval;
    window.clearInterval = prevClearInterval;
    delete (document as unknown as { visibilityState?: string }).visibilityState;
    if (internal().reconnectTimeout) clearTimeout(internal().reconnectTimeout as number);
    if (internal().disconnectBannerTimeout) {
      clearTimeout(internal().disconnectBannerTimeout as number);
      internal().disconnectBannerTimeout = null;
    }
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      connectionState: "connecting",
    });
  });

  test("on connect it reports the page's state, in a frame the server's gate accepts", () => {
    open();
    const frames = visibilityFrames();
    expect(frames).toEqual([{ type: "visibility", state: "visible" }]);
    expect(ClientMessage.safeParse(frames[0]).success).toBe(true);
  });

  test("every change of visibility is reported", () => {
    open();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(visibilityFrames().map((msg) => msg.state)).toEqual(["visible", "hidden", "visible"]);
  });

  test("the heartbeat repeats `visible` and says nothing while hidden", () => {
    open();
    heartbeat?.fn();
    setVisibility("hidden");
    heartbeat?.fn();
    expect(visibilityFrames().map((msg) => msg.state)).toEqual(["visible", "visible"]);
  });

  test("the heartbeat outpaces the server's freshness bound with a repeat to spare", () => {
    open();
    expect(heartbeat?.ms).toBe(VISIBILITY_HEARTBEAT_MS);
    expect(2 * VISIBILITY_HEARTBEAT_MS).toBeLessThan(FOREGROUND_FRESH_MS);
  });

  test("a socket that is no longer current reports nothing and stops its heartbeat", () => {
    open();
    sent = [];
    internal().ws = null;
    document.dispatchEvent(new Event("visibilitychange"));
    heartbeat?.fn();
    expect(sent).toEqual([]);
    expect(cleared).toEqual([41]);
  });

  test("a closed socket stops reporting", () => {
    open();
    sent = [];
    socket.onclose();
    expect(cleared).toEqual([41]);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sent).toEqual([]);
  });
});
