import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * ClientAdoptsServerAgentStates — the live-session reply is also the status
 * bootstrap. Before this, a reloaded client had no activity information until
 * the next status event fired, so the dot stayed on whatever localStorage had
 * cached. Now every live session is marked as spoken-for the moment the reply
 * lands, whether or not herdr had a state to report.
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

function session(id: string) {
  return useAppStore.getState().sessions.get(id);
}

describe("ClientAdoptsServerAgentStates", () => {
  let prevWs: WebSocket | null;
  const originalToastInfo = toastService.info;

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
    toastService.info = originalToastInfo;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    localStorage.clear();
  });

  test("a reported running state lands on the session and drives the spinner", () => {
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage({
      type: "terminal_sessions",
      claudeUuids: ["u1"],
      unknownUuids: [],
      states: { u1: "running" },
    });

    expect(session("u1")?.agentState).toBe("running");
    expect(session("u1")?.isStreaming).toBe(true);
    expect(session("u1")?.receivedAuthoritativeState).toBe(true);
  });

  test("a live session with no reported state is still spoken-for", () => {
    // herdr answers "unknown" for some adopted panes. That is not a state, but
    // it is still an answer — the card must not look unheard-from.
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage({
      type: "terminal_sessions",
      claudeUuids: ["u1"],
      unknownUuids: [],
      states: {},
    });

    expect(session("u1")?.agentState).toBeNull();
    expect(session("u1")?.receivedAuthoritativeState).toBe(true);
  });

  test("an older server that sends no states map still marks live sessions", () => {
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage({
      type: "terminal_sessions",
      claudeUuids: ["u1"],
      unknownUuids: [],
    });

    expect(session("u1")?.agentState).toBeNull();
    expect(session("u1")?.receivedAuthoritativeState).toBe(true);
  });

  test("an unrecognised state string is ignored rather than stored", () => {
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage({
      type: "terminal_sessions",
      claudeUuids: ["u1"],
      unknownUuids: [],
      states: { u1: "nonsense" },
    });

    expect(session("u1")?.agentState).toBeNull();
    expect(session("u1")?.receivedAuthoritativeState).toBe(true);
  });

  test("a session the remount skipped is not treated as spoken-for", () => {
    // Skipped means "no verdict", so the card keeps its pre-reply silence
    // instead of claiming the server confirmed it.
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage({
      type: "terminal_sessions",
      claudeUuids: [],
      unknownUuids: ["u1"],
      states: {},
    });

    expect(session("u1")?.receivedAuthoritativeState).toBe(false);
  });
});
