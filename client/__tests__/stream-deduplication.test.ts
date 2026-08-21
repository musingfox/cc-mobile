import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

function internals() {
  return wsService as unknown as {
    ws: unknown;
    handleMessage: (message: Record<string, unknown>) => void;
  };
}

describe("assistant stream_chunk identity", () => {
  const sessionId = "test-session";
  let previousWs: unknown;

  beforeEach(() => {
    previousWs = internals().ws;
    internals().ws = { send: () => {} };
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
    });
    useAppStore.getState().addSession(sessionId, "/test");
  });

  afterEach(() => {
    internals().ws = previousWs;
  });

  test("assistant stream_chunk applies through applyTranscriptMessages with recordId and seq", () => {
    internals().handleMessage({
      type: "stream_chunk",
      sessionId,
      chunk: {
        type: "assistant",
        recordId: "rec-live-1",
        seq: 42,
        message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
      },
    });

    const session = useAppStore.getState().sessions.get(sessionId);
    expect(session).toBeDefined();
    const assistant = session?.messages.filter((m) => m.role === "assistant") ?? [];
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toBe("Hello world");
    expect(assistant[0].recordId).toBe("rec-live-1");
    expect(assistant[0].seq).toBe(42);
    expect(session?.isStreaming).toBe(true);
  });

  test("stream_end clears the live-turn streaming flag", () => {
    internals().handleMessage({
      type: "stream_chunk",
      sessionId,
      chunk: {
        type: "assistant",
        recordId: "rec-live-2",
        seq: 43,
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      },
    });
    internals().handleMessage({ type: "stream_end", sessionId });

    const session = useAppStore.getState().sessions.get(sessionId);
    expect(session?.isStreaming).toBe(false);
    expect(session?.messages.some((m) => m.role === "assistant" && m.content === "done")).toBe(true);
  });
});
