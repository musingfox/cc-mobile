import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * SessionRemovalDropsReplayCursor — removing a session forgets its replay
 * cursor as well as its card. Without this, every reconnect kept re-sending
 * cursors for sessions that no longer exist, and the orphan set only ever grew.
 */

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
    handleMessage: (msg: Record<string, unknown>) => void;
    pendingTerminalCreates: Set<string>;
    lastEventIds: Map<string, number>;
  };
}

function storedCursors() {
  const raw = localStorage.getItem("ccm:lastEventIds");
  return raw ? (JSON.parse(raw) as Record<string, number>) : null;
}

/** Two live cards with cursors, of which herdr will only confirm u1. */
function seedTwoSessionsWithCursors() {
  useAppStore.getState().addSession("u1", "/tmp", { ready: true });
  useAppStore.getState().addSession("u2", "/tmp", { ready: true });
  localStorage.setItem("ccm:lastEventIds", JSON.stringify({ u1: 5, u2: 9 }));
  getInternal().lastEventIds.set("u1", 5);
  getInternal().lastEventIds.set("u2", 9);
}

describe("SessionRemovalDropsReplayCursor", () => {
  let prevWs: WebSocket | null;
  const originalToastInfo = toastService.info;

  beforeEach(() => {
    prevWs = getInternal().ws;
    getInternal().ws = new FakeWebSocket() as unknown as WebSocket;
    getInternal().pendingTerminalCreates.clear();
    getInternal().lastEventIds.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    toastService.info = mock((_msg: string): string | number => 0) as typeof toastService.info;
    localStorage.clear();
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    getInternal().pendingTerminalCreates.clear();
    getInternal().lastEventIds.clear();
    toastService.info = originalToastInfo;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    localStorage.clear();
  });

  test("the reconcile drops the removed session's stored cursor", () => {
    seedTwoSessionsWithCursors();

    getInternal().handleMessage({
      type: "terminal_sessions",
      claudeUuids: ["u1"],
      unknownUuids: [],
    });

    expect(storedCursors()).toEqual({ u1: 5 });
  });

  test("the next reconnect carries neither the dead cursor nor its id", () => {
    seedTwoSessionsWithCursors();

    getInternal().handleMessage({
      type: "terminal_sessions",
      claudeUuids: ["u1"],
      unknownUuids: [],
    });

    const sent: Record<string, unknown>[] = [];
    const prevCtor = globalThis.WebSocket;
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
    try {
      wsService.connect();
      (opened as unknown as { onopen: () => void }).onopen();
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = prevCtor;
    }

    const reconnect = sent.find((msg) => msg.type === "reconnect");
    expect(reconnect?.lastEventIds).toEqual({ u1: 5 });
    expect(reconnect?.sessionIds).toEqual(["u1"]);

    useAppStore.setState({ connectionState: "connecting" });
  });
});
