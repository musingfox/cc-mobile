import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ClientMessage, ServerMessage } from "../../server/protocol";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
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
