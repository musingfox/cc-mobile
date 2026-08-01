import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * ClientPromptSend — a prompt on a terminal session goes out as `terminal_send`
 * (newlines verbatim), shows an optimistic user bubble + spinner (Loading), and
 * the reply lands through the existing stream_chunk/stream_end handlers
 * (Success) or the error handler (Error). A second send is another `terminal_send`
 * with no create — multi-turn.
 */

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
    handleMessage: (msg: Record<string, unknown>) => void;
  };
}

function sentPayloads(fake: FakeWebSocket) {
  return fake.send.mock.calls.map((c) => JSON.parse(c[0] as string));
}

describe("wsService.terminalSend", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("s1", "/cwd", { ready: true });
  });

  afterEach(() => {
    getInternal().ws = prevWs;
  });

  test("emits terminal_send with the prompt verbatim + optimistic bubble and spinner", () => {
    wsService.terminalSend("s1", "line1\nline2");

    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(sentPayloads(fake)[0]).toEqual({
      type: "terminal_send",
      claudeUuid: "s1",
      content: "line1\nline2",
    });

    const session = useAppStore.getState().sessions.get("s1");
    expect(session?.messages.length).toBe(1);
    expect(session?.messages[0].role).toBe("user");
    expect(session?.messages[0].content).toBe("line1\nline2");
    expect(session?.isStreaming).toBe(true);
  });

  test("assistant stream_chunk + stream_end render the reply and stop the spinner", () => {
    wsService.terminalSend("s1", "hey");

    getInternal().handleMessage({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      },
    });
    getInternal().handleMessage({ type: "stream_end", sessionId: "s1" });

    const session = useAppStore.getState().sessions.get("s1");
    const assistantMessages = session?.messages.filter((m) => m.role === "assistant") ?? [];
    expect(assistantMessages.length).toBe(1);
    expect(assistantMessages[0].content).toBe("hi");
    expect(session?.isStreaming).toBe(false);
  });

  test("terminal_send_failed renders an error bubble and stops the spinner", () => {
    wsService.terminalSend("s1", "hey");

    getInternal().handleMessage({
      type: "error",
      sessionId: "s1",
      code: "terminal_send_failed",
      message: "gone",
    });

    const session = useAppStore.getState().sessions.get("s1");
    const last = session?.messages[session.messages.length - 1];
    expect(last?.content).toBe("Error: gone");
    expect(session?.isStreaming).toBe(false);
  });

  test("a second turn emits another terminal_send and never a terminal_create", () => {
    wsService.terminalSend("s1", "first");
    getInternal().handleMessage({ type: "stream_end", sessionId: "s1" });
    wsService.terminalSend("s1", "again");

    const payloads = sentPayloads(fake);
    expect(payloads.map((p) => p.type)).toEqual(["terminal_send", "terminal_send"]);
    expect(payloads[1].content).toBe("again");
    expect(payloads.some((p) => p.type === "terminal_create")).toBe(false);
  });
});
