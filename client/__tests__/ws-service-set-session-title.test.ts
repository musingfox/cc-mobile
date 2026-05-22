import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { wsService } from "../services/ws-service";

/**
 * Minimal fake WebSocket — only `send` is used by ws-service's `sendMessage`.
 */
class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as { ws: WebSocket | null };
}

describe("wsService.setSessionTitle", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
  });

  afterEach(() => {
    getInternal().ws = prevWs;
  });

  test("sends set_session_title with dir when provided", () => {
    wsService.setSessionTitle("uuid-1", "Hi", "/p");
    expect(fake.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fake.send.mock.calls[0][0] as string);
    expect(payload).toEqual({
      type: "set_session_title",
      sdkSessionId: "uuid-1",
      title: "Hi",
      dir: "/p",
    });
  });

  test("omits dir field when not provided", () => {
    wsService.setSessionTitle("uuid-2", "Bye");
    expect(fake.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fake.send.mock.calls[0][0] as string);
    expect(payload).toEqual({
      type: "set_session_title",
      sdkSessionId: "uuid-2",
      title: "Bye",
    });
    expect("dir" in payload).toBe(false);
  });

  test("is a no-op when socket is not connected", () => {
    getInternal().ws = null;
    expect(() => wsService.setSessionTitle("uuid-3", "x", "/p")).not.toThrow();
    expect(fake.send).not.toHaveBeenCalled();
  });
});
