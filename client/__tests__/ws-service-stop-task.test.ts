import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { wsService } from "../services/ws-service";

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as { ws: WebSocket | null };
}

describe("wsService.stopTask", () => {
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

  test("sends exactly one stop_task frame with sessionId and taskId", () => {
    wsService.stopTask("s1", "t1");

    expect(fake.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fake.send.mock.calls[0][0] as string);
    expect(payload).toEqual({ type: "stop_task", sessionId: "s1", taskId: "t1" });
  });

  test("no socket: no-op", () => {
    getInternal().ws = null;
    wsService.stopTask("s1", "t1");
    expect(fake.send).not.toHaveBeenCalled();
  });
});
