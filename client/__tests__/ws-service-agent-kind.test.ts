import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * AgentKindReachesClientStore — the listing says which agent runs in a pane, in
 * herdr's own wording, and the card keeps that answer verbatim. A pane herdr
 * cannot label carries no kind at all: the client never guesses one (#30).
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

/** A `terminal_sessions` reply listing exactly one foreign pane. */
function listing(overrides: Record<string, unknown> = {}) {
  return {
    type: "terminal_sessions",
    sessions: [
      {
        sessionId: "w6C:p1",
        cwd: "/repo",
        origin: "foreign",
        drivable: true,
        readable: false,
        gated: true,
        ...overrides,
      },
    ],
  };
}

describe("wsService agent kind from the session listing", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    getInternal().pendingTerminalCreates.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    localStorage.clear();
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    getInternal().pendingTerminalCreates.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    localStorage.clear();
  });

  test("a listed pane running another agent keeps that kind on its card", () => {
    getInternal().handleMessage(listing({ agent: "omp" }));

    expect(useAppStore.getState().sessions.get("w6C:p1")?.descriptor?.agent).toBe("omp");
  });

  test("a listing with no kind leaves the card's kind unknown, other flags intact", () => {
    getInternal().handleMessage(listing());

    const flags = useAppStore.getState().sessions.get("w6C:p1")?.descriptor;
    expect(flags?.agent).toBeUndefined();
    expect(flags?.readable).toBe(false);
    expect(flags?.gated).toBe(true);
    expect(flags?.origin).toBe("foreign");
  });

  test("a non-string kind is ignored and the card is still created", () => {
    getInternal().handleMessage(listing({ agent: 7 }));

    const session = useAppStore.getState().sessions.get("w6C:p1");
    expect(session).toBeDefined();
    expect(session?.descriptor?.agent).toBeUndefined();
  });
});
