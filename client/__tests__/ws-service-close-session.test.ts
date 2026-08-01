import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * Closing a session must not orphan its backing terminal workspace: a
 * terminal-marked session sends `tmux_teardown` so the server kills the live
 * `claude` process, while a plain SDK session keeps the `interrupt` path.
 */

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
  };
}

function sentMessages(fake: FakeWebSocket) {
  return fake.send.mock.calls.map((call) => JSON.parse(call[0] as string));
}

describe("wsService closeSession", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  afterEach(() => {
    getInternal().ws = prevWs;
  });

  test("terminal session close sends tmux_teardown and removes the session", () => {
    useAppStore.getState().addSession("uuid-term", "/tmp", { ready: true });

    wsService.closeSession("uuid-term");

    expect(sentMessages(fake)).toEqual([{ type: "tmux_teardown", claudeUuid: "uuid-term" }]);
    expect(useAppStore.getState().sessions.has("uuid-term")).toBe(false);
  });

  test("not-yet-ready terminal session close still sends tmux_teardown", () => {
    useAppStore.getState().addSession("uuid-pending", "/tmp", { ready: false });

    wsService.closeSession("uuid-pending");

    expect(sentMessages(fake)).toEqual([{ type: "tmux_teardown", claudeUuid: "uuid-pending" }]);
  });

  test("non-terminal session close sends interrupt, never tmux_teardown", () => {
    useAppStore.getState().addSession("uuid-sdk", "/tmp");

    wsService.closeSession("uuid-sdk");

    expect(sentMessages(fake)).toEqual([{ type: "interrupt", sessionId: "uuid-sdk" }]);
    expect(useAppStore.getState().sessions.has("uuid-sdk")).toBe(false);
  });

  test("socket down: nothing sent, session still removed", () => {
    getInternal().ws = null;
    useAppStore.getState().addSession("uuid-off", "/tmp", { ready: true });

    wsService.closeSession("uuid-off");

    expect(fake.send).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessions.has("uuid-off")).toBe(false);
  });
});
