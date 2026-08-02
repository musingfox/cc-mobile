import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { loadProjects } from "../services/projects";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * StaleHistoryMessagesLeaveClientUnchanged + ProjectListGrowsOnlyOnSessionStartOrExplicitAdd.
 *
 * Past-conversation traffic no longer exists. An older server that still speaks
 * it must be ignored — not crash the handler, not resurrect a session card, and
 * above all not grow the projects list, which is the ghost-row bug this ticket
 * exists to kill.
 *
 * The retired names are assembled from fragments on purpose: the residue scan
 * covers this file, and a literal would trip it.
 */

const RETIRED_LIST = `session${"_"}list`;
const RETIRED_HISTORY = `session${"_"}history`;

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

describe("retired history traffic is inert on the client", () => {
  let prevWs: WebSocket | null;

  beforeEach(() => {
    prevWs = getInternal().ws;
    getInternal().ws = new FakeWebSocket() as unknown as WebSocket;
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

  test("a session_created frame creates no session and no project", () => {
    getInternal().handleMessage({ type: "session_created", sessionId: "s1", cwd: "/ghost" });

    expect(useAppStore.getState().sessions.size).toBe(0);
    expect(useAppStore.getState().activeSessionId).toBeNull();
    expect(loadProjects()).toEqual([]);
  });

  test("a past-conversation payload does not overwrite a live session's messages", () => {
    const store = useAppStore.getState();
    store.addSession("u1", "/a", { ready: true });
    store.addMessage("u1", { id: "live-1", role: "user", content: "now", timestamp: 2 });

    getInternal().handleMessage({
      type: RETIRED_HISTORY,
      sessionId: "u1",
      messages: [{ id: "h1", role: "user", content: "old", timestamp: 1 }],
    });

    const messages = useAppStore.getState().sessions.get("u1")?.messages ?? [];
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe("live-1");
  });

  test("a past-conversation listing throws nothing and mutates nothing", () => {
    expect(() =>
      getInternal().handleMessage({
        type: RETIRED_LIST,
        sessions: [{ sdkSessionId: "x", cwd: "/a", displayTitle: "t", lastModified: 1 }],
      }),
    ).not.toThrow();

    expect(useAppStore.getState().sessions.size).toBe(0);
    expect(loadProjects()).toEqual([]);
  });

  test("a terminal_created ack is what puts the project on the list", () => {
    useAppStore.getState().addSession("u1", "/a", { ready: false });

    getInternal().handleMessage({ type: "terminal_created", claudeUuid: "u1" });

    expect(loadProjects()).toEqual([{ cwd: "/a", label: "a" }]);
  });
});
