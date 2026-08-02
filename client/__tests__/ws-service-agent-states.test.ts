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

/** A `terminal_sessions` reply; per-session state rides on the descriptor. */
function listing(entries: { sessionId: string; state?: string; cwd?: string }[]) {
  return {
    type: "terminal_sessions",
    sessions: entries.map((entry) => ({
      sessionId: entry.sessionId,
      agentSessionValue: null,
      cwd: entry.cwd ?? "/a",
      origin: "self",
      drivable: true,
      readable: true,
      gated: true,
      ...(entry.state ? { state: entry.state } : {}),
    })),
    claudeUuids: entries.map((entry) => entry.sessionId),
  };
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

    getInternal().handleMessage(listing([{ sessionId: "u1", state: "running" }]));

    expect(session("u1")?.agentState).toBe("running");
    expect(session("u1")?.isStreaming).toBe(true);
    expect(session("u1")?.receivedAuthoritativeState).toBe(true);
  });

  test("a live session with no reported state is still spoken-for", () => {
    // herdr answers "unknown" for some adopted panes. That is not a state, but
    // it is still an answer — the card must not look unheard-from.
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage(listing([{ sessionId: "u1" }]));

    expect(session("u1")?.agentState).toBeNull();
    expect(session("u1")?.receivedAuthoritativeState).toBe(true);
  });

  test("an older server that sends no states map still marks live sessions", () => {
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage(listing([{ sessionId: "u1" }]));

    expect(session("u1")?.agentState).toBeNull();
    expect(session("u1")?.receivedAuthoritativeState).toBe(true);
  });

  test("an unrecognised state string is ignored rather than stored", () => {
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage(listing([{ sessionId: "u1", state: "nonsense" }]));

    expect(session("u1")?.agentState).toBeNull();
    expect(session("u1")?.receivedAuthoritativeState).toBe(true);
  });

  test("a freshly created session is spoken-for the moment the ack lands", () => {
    // Otherwise a brand-new session shows no dot at all until the next
    // reconnect or the first prompt — the opposite of what the user just did.
    useAppStore.getState().addSession("u1", "/a", { ready: false });
    getInternal().pendingTerminalCreates.add("u1");

    getInternal().handleMessage({ type: "terminal_created", claudeUuid: "u1", sessionId: "u1" });

    expect(session("u1")?.agentState).toBe("idle");
    expect(session("u1")?.isStreaming).toBe(false);
    expect(session("u1")?.receivedAuthoritativeState).toBe(true);
  });

  test("a replayed create ack does not blank a session that is already running", () => {
    // The ack is buffered, so a reconnect replays it. By then this connection
    // is not waiting on the create any more, and herdr's state is the truth.
    useAppStore.getState().addSession("u1", "/a", { ready: true });
    useAppStore.getState().setAgentState("u1", "running");

    getInternal().handleMessage({ type: "terminal_created", claudeUuid: "u1", sessionId: "u1" });

    expect(session("u1")?.agentState).toBe("running");
    expect(session("u1")?.isStreaming).toBe(true);
  });

  test("a session the server does not list is gone, not merely unheard-from", () => {
    // "Skipped, leave alone" existed only while a startup scan could decline to
    // adopt a pane. The list is a live daemon query now: absent means gone.
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage(listing([]));

    expect(session("u1")).toBeUndefined();
  });
});
