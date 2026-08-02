import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * ClientSessionRekey (create half) — the card the phone put up optimistically
 * moves onto the session id the server assigned.
 *
 * Since #29 the session key on the wire is herdr's pane id, not the uuid the
 * client minted for the request: a pane id exists for every session, including
 * ones with no claude session uuid, and it survives a `/clear` that rotates the
 * uuid (Decision H5). The request uuid survives only as the buffer slot the ack
 * was written into (Decision M15), which is why the ack carries both.
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

describe("ClientSessionRekey", () => {
  let prevWs: WebSocket | null;
  const originalInfo = toastService.info;

  beforeEach(() => {
    prevWs = getInternal().ws;
    getInternal().ws = new FakeWebSocket() as unknown as WebSocket;
    getInternal().pendingTerminalCreates.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    toastService.info = mock((_msg: string): string | number => 0) as typeof toastService.info;
    localStorage.clear();
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    getInternal().pendingTerminalCreates.clear();
    toastService.info = originalInfo;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    localStorage.clear();
  });

  test("the optimistic card moves to the server's session id, keeping its cwd", () => {
    useAppStore.getState().addSession("u1", "/repo", { ready: false });
    getInternal().pendingTerminalCreates.add("u1");

    getInternal().handleMessage({
      type: "terminal_created",
      claudeUuid: "u1",
      sessionId: "w1:p1",
      terminalName: "ccm-u1",
      paneRef: "w1:p1",
    });

    const sessions = useAppStore.getState().sessions;
    expect(sessions.has("u1")).toBe(false);
    expect(sessions.get("w1:p1")?.cwd).toBe("/repo");
    expect(sessions.get("w1:p1")?.terminal?.ready).toBe(true);
    expect(useAppStore.getState().activeSessionId).toBe("w1:p1");
  });

  test("the new card is the one that becomes idle, not the request uuid", () => {
    useAppStore.getState().addSession("u1", "/repo", { ready: false });
    getInternal().pendingTerminalCreates.add("u1");

    getInternal().handleMessage({
      type: "terminal_created",
      claudeUuid: "u1",
      sessionId: "w1:p1",
    });

    expect(useAppStore.getState().sessions.get("w1:p1")?.agentState).toBe("idle");
  });

  test("a replayed ack after a reconnect resurrects nothing", () => {
    // The ack is buffered under the request uuid, so a reconnect replays it.
    useAppStore.getState().addSession("u1", "/repo", { ready: false });
    getInternal().handleMessage({ type: "terminal_created", claudeUuid: "u1", sessionId: "w1:p1" });

    getInternal().handleMessage({ type: "terminal_created", claudeUuid: "u1", sessionId: "w1:p1" });

    expect([...useAppStore.getState().sessions.keys()]).toEqual(["w1:p1"]);
  });

  test("an ack from a server that sends no sessionId still readies the card", () => {
    useAppStore.getState().addSession("u1", "/repo", { ready: false });

    getInternal().handleMessage({ type: "terminal_created", claudeUuid: "u1" });

    expect(useAppStore.getState().sessions.get("u1")?.terminal?.ready).toBe(true);
  });
});
