import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * One socket at a time. The `online`, `pageshow` and visibility handlers all
 * call `connect()`, and so does the backoff timer a close leaves behind; with
 * no guard, going offline and back online opened a socket from the handler and
 * a second one from the timer ~10 s later, both kept open, each sending its
 * own `reconnect` (audit 2026-10-03 #6).
 */

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static made: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: (error: unknown) => void;
  onclose?: () => void;
  sent: string[] = [];

  constructor() {
    FakeSocket.made.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeSocket.CLOSING;
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  closed() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

type Internals = {
  ws: WebSocket | null;
  socket: WebSocket | null;
  reconnectDelay: number;
  reconnectTimeout: number | null;
  disconnectBannerTimeout: number | null;
};

const internal = wsService as unknown as Internals;
const realWebSocket = globalThis.WebSocket;

describe("one socket at a time", () => {
  beforeEach(() => {
    FakeSocket.made = [];
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    internal.ws = null;
    internal.socket = null;
    internal.reconnectDelay = 5;
  });

  afterEach(() => {
    if (internal.reconnectTimeout !== null) clearTimeout(internal.reconnectTimeout);
    if (internal.disconnectBannerTimeout !== null) clearTimeout(internal.disconnectBannerTimeout);
    internal.reconnectTimeout = null;
    internal.disconnectBannerTimeout = null;
    for (const socket of FakeSocket.made) {
      socket.onclose = undefined;
      socket.readyState = FakeSocket.CLOSED;
    }
    internal.ws = null;
    internal.socket = null;
    internal.reconnectDelay = 1000;
    globalThis.WebSocket = realWebSocket;
  });

  test("a second connect while the first is still opening opens nothing", () => {
    wsService.connect();
    wsService.connect();

    expect(FakeSocket.made).toHaveLength(1);
  });

  test("a connect while open opens nothing", () => {
    wsService.connect();
    FakeSocket.made[0].open();

    wsService.connect();

    expect(FakeSocket.made).toHaveLength(1);
  });

  test("back online: the handler's socket is the only one, the backoff timer adds none", async () => {
    wsService.connect();
    FakeSocket.made[0].open();
    // An open resets the backoff to 1 s; shortened so the timer fires here.
    internal.reconnectDelay = 5;
    FakeSocket.made[0].closed();

    // The `online` handler, before the backoff timer has fired.
    wsService.connect();
    expect(FakeSocket.made).toHaveLength(2);

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(FakeSocket.made).toHaveLength(2);
  });

  test("a superseded socket closing late neither drops the live one nor schedules another", () => {
    wsService.connect();
    const first = FakeSocket.made[0];
    first.open();
    first.close();

    wsService.connect();
    const second = FakeSocket.made[1];
    second.open();
    first.closed();

    expect(internal.ws).toBe(second as unknown as WebSocket);
    expect(internal.reconnectTimeout).toBeNull();
  });

  test("a superseded socket closing late still stops its own visibility heartbeat", () => {
    const realSetInterval = window.setInterval;
    const realClearInterval = window.clearInterval;
    let nextId = 100;
    const cleared: unknown[] = [];
    window.setInterval = (() => ++nextId) as unknown as typeof window.setInterval;
    window.clearInterval = ((id: unknown) => {
      cleared.push(id);
    }) as typeof window.clearInterval;
    try {
      wsService.connect();
      const first = FakeSocket.made[0];
      first.open();
      first.close();
      wsService.connect();
      FakeSocket.made[1].open();

      first.closed();

      expect(cleared).toEqual([101]);
    } finally {
      window.setInterval = realSetInterval;
      window.clearInterval = realClearInterval;
    }
  });
});
