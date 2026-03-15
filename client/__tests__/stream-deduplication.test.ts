import { describe, test, expect, beforeEach } from "bun:test";
import { useAppStore } from "../stores/app-store";

// Helper to simulate WebSocket message handling
function handleStreamChunk(sessionId: string, chunk: Record<string, unknown>) {
  const store = useAppStore.getState();

  // Replicate the extractTextFromChunk logic
  let text: string | null = null;
  if (chunk.type === "assistant") {
    const message = chunk.message as { content?: Array<{ type: string; text?: string }> } | undefined;
    if (message?.content) {
      text = message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
    }
  } else if (chunk.type === "stream_event") {
    const event = chunk.event as Record<string, unknown> | undefined;
    if (event?.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta") {
        text = (delta.text as string) ?? null;
      }
    }
  }

  if (!text) return;

  const session = store.sessions.get(sessionId);
  if (!session) return;

  store.setStreaming(sessionId, true);

  // Handle stream_event chunks: create/append incrementally
  if (chunk.type === "stream_event") {
    if (session.currentStreamMessageId) {
      store.appendToLastAssistantMessage(sessionId, text);
    } else {
      const newId = `msg-${Date.now()}-${Math.random()}`;
      store.startStreamMessage(sessionId, newId, text);
    }
  }
  // Handle assistant messages: dedup if already streamed
  else if (chunk.type === "assistant") {
    // If we have a current stream, check if this assistant message is a duplicate
    if (session.currentStreamMessageId) {
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg && lastMsg.id === session.currentStreamMessageId) {
        // Skip if content matches (deduplication)
        if (lastMsg.content === text) {
          return;
        }
      }
    }
    // No active stream: create message normally
    if (!session.currentStreamMessageId) {
      store.addMessage(sessionId, {
        id: `msg-${Date.now()}-${Math.random()}`,
        role: "assistant",
        content: text,
        timestamp: Date.now(),
      });
    }
  }
}

function handleStreamEnd(sessionId: string) {
  const store = useAppStore.getState();
  store.setStreaming(sessionId, false);
}

describe("stream deduplication", () => {
  const sessionId = "test-session";

  beforeEach(() => {
    // Reset store before each test
    useAppStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      connectionState: "connected",
      capabilities: null,
      globalError: null,
      inputDraft: "",
    });

    // Add test session
    useAppStore.getState().addSession(sessionId, "/tmp");
  });

  // T6: stream_event deltas build message incrementally
  test("stream_event deltas build message incrementally", () => {
    const streamEvent1 = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
    };
    const streamEvent2 = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: " " },
      },
    };
    const streamEvent3 = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "world" },
      },
    };

    handleStreamChunk(sessionId, streamEvent1);
    handleStreamChunk(sessionId, streamEvent2);
    handleStreamChunk(sessionId, streamEvent3);

    const session = useAppStore.getState().sessions.get(sessionId);
    expect(session?.messages.length).toBe(1);
    expect(session?.messages[0]?.content).toBe("Hello world");
    expect(session?.messages[0]?.role).toBe("assistant");
  });

  // T7: final assistant message during stream is ignored (dedup)
  test("final assistant message during stream is ignored (dedup)", () => {
    const streamEvent1 = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
    };
    const streamEvent2 = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: " world" },
      },
    };
    const assistantMessage = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    };

    handleStreamChunk(sessionId, streamEvent1);
    handleStreamChunk(sessionId, streamEvent2);
    handleStreamChunk(sessionId, assistantMessage);

    const session = useAppStore.getState().sessions.get(sessionId);
    expect(session?.messages.length).toBe(1);
    expect(session?.messages[0]?.content).toBe("Hello world");
  });

  // T8: assistant message without prior stream creates message normally
  test("assistant message without prior stream creates message normally", () => {
    const assistantMessage = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Complete message" }],
      },
    };

    handleStreamChunk(sessionId, assistantMessage);

    const session = useAppStore.getState().sessions.get(sessionId);
    expect(session?.messages.length).toBe(1);
    expect(session?.messages[0]?.content).toBe("Complete message");
    expect(session?.messages[0]?.role).toBe("assistant");
  });

  // T9: stream_end resets state for next message
  test("stream_end resets state for next message", () => {
    const streamEvent1 = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "First" },
      },
    };
    const streamEvent2 = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Second" },
      },
    };

    handleStreamChunk(sessionId, streamEvent1);
    handleStreamEnd(sessionId);
    handleStreamChunk(sessionId, streamEvent2);

    const session = useAppStore.getState().sessions.get(sessionId);
    expect(session?.messages.length).toBe(2);
    expect(session?.messages[0]?.content).toBe("First");
    expect(session?.messages[1]?.content).toBe("Second");
  });
});
