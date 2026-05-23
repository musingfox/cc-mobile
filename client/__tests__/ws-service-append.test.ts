import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ContentBlock } from "../../server/protocol";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as { ws: WebSocket | null };
}

function resetStore() {
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
  });
  useAppStore.getState().addSession("s1", "/cwd");
}

describe("wsService.appendUserMessage", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    resetStore();
  });

  afterEach(() => {
    getInternal().ws = prevWs;
  });

  test("string content: optimistic user message + frame, no streaming", () => {
    wsService.appendUserMessage("s1", "hi");

    const session = useAppStore.getState().sessions.get("s1");
    expect(session).toBeDefined();
    expect(session?.messages.length).toBe(1);
    expect(session?.messages[0].role).toBe("user");
    expect(session?.messages[0].content).toBe("hi");
    expect(session?.isStreaming).toBeFalsy();

    expect(fake.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fake.send.mock.calls[0][0] as string);
    expect(payload.type).toBe("append_user_message");
    expect(payload.sessionId).toBe("s1");
    expect(payload.content).toBe("hi");
  });

  test("ContentBlock[] with text + image: stores text-only display + sends full array", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "look at this" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc" },
      },
    ];
    wsService.appendUserMessage("s1", content);

    const session = useAppStore.getState().sessions.get("s1");
    const msg = session?.messages[0];
    expect(msg?.content).toBe("look at this");
    expect(msg?.contentBlocks).toEqual(content);
    expect(session?.isStreaming).toBeFalsy();

    const payload = JSON.parse(fake.send.mock.calls[0][0] as string);
    expect(payload.content).toEqual(content);
  });

  test("no socket: no-op, store untouched", () => {
    getInternal().ws = null;
    wsService.appendUserMessage("s1", "hi");
    const session = useAppStore.getState().sessions.get("s1");
    expect(session?.messages.length).toBe(0);
    expect(fake.send).not.toHaveBeenCalled();
  });
});
