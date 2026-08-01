import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * ReadOnlySessionRefusesInput — grounding the discriminant.
 *
 * InputBarA decides "read-only history view" from `session.terminal === undefined`.
 * That is only sound if the writers agree: the resume landing (`session_created`)
 * must leave `terminal` absent, and the terminal-create landing must set it. These
 * cases drive the real ws-service handlers rather than hand-seeding the store, so
 * a future writer that forgets the marker turns a live pane read-only loudly.
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

describe("terminal marker written by the real session landings", () => {
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
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    localStorage.clear();
  });

  test("a resumed session lands without a terminal marker (read-only view)", () => {
    getInternal().handleMessage({
      type: "session_created",
      sessionId: "resumed-1",
      cwd: "/tmp/proj",
    });

    const session = useAppStore.getState().sessions.get("resumed-1");
    expect(session).toBeDefined();
    expect(session?.cwd).toBe("/tmp/proj");
    expect(session?.terminal).toBeUndefined();
  });

  test("history arriving for a resumed session does not grant it a terminal", () => {
    getInternal().handleMessage({
      type: "session_created",
      sessionId: "resumed-2",
      cwd: "/tmp/proj",
    });
    getInternal().handleMessage({
      type: "session_history",
      sessionId: "resumed-2",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(useAppStore.getState().sessions.get("resumed-2")?.terminal).toBeUndefined();
  });

  test("a terminal session is created with the marker and becomes ready on ack", () => {
    wsService.createTerminalSession("/tmp/proj");
    const created = [...useAppStore.getState().sessions.entries()].find(
      ([, s]) => s.cwd === "/tmp/proj",
    );
    if (!created) throw new Error("terminal session was not added to the store");
    const [uuid, session] = created;

    // Present but not yet ready: the composer shows "starting", not read-only.
    expect(session.terminal).toEqual({ ready: false });

    getInternal().handleMessage({ type: "terminal_created", claudeUuid: uuid });
    expect(useAppStore.getState().sessions.get(uuid)?.terminal?.ready).toBe(true);
  });
});
