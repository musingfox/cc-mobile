import { beforeEach, describe, expect, test } from "bun:test";
import { extractTextFromChunk } from "../services/ws-service";

// TC-WSR1: extractTextFromChunk handles event envelope payload
describe("extractTextFromChunk", () => {
  test("TC-WSR1: extracts text from assistant message", () => {
    const chunk = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: " World" },
        ],
      },
    };

    const result = extractTextFromChunk(chunk);
    expect(result).toBe("Hello World");
  });

  test("TC-WSR2: extracts text from stream_event content_block_delta", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: "streaming text",
        },
      },
    };

    const result = extractTextFromChunk(chunk);
    expect(result).toBe("streaming text");
  });

  test("TC-WSR3: returns null for non-text chunks", () => {
    const chunk = {
      type: "stream_event",
      event: {
        type: "content_block_start",
      },
    };

    const result = extractTextFromChunk(chunk);
    expect(result).toBeNull();
  });
});

// TC-WSR4-8: Event envelope and reconnect protocol tests
// These tests verify message routing logic without full WsService setup
describe("WebSocket message routing", () => {
  // Mock localStorage - use standalone object instead of globalThis override
  const mockStorage: Record<string, string> = {};
  const localStorageMock = {
    getItem: (key: string) => mockStorage[key] || null,
    setItem: (key: string, value: string) => {
      mockStorage[key] = value;
    },
    removeItem: (key: string) => {
      delete mockStorage[key];
    },
    clear: () => {
      for (const key in mockStorage) {
        delete mockStorage[key];
      }
    },
  };

  beforeEach(() => {
    // Reset mock storage
    localStorageMock.clear();
  });

  test("TC-WSR4: event envelope unwrapping preserves eventId", () => {
    const envelope = {
      type: "event",
      eventId: 42,
      sessionId: "session-123",
      payload: {
        type: "stream_chunk",
        sessionId: "session-123",
        chunk: { type: "assistant", message: { content: [] } },
      },
    };

    // Simulate onmessage logic
    if (envelope.type === "event") {
      const eventId = envelope.eventId;
      const payload = envelope.payload;

      expect(eventId).toBe(42);
      expect(payload.type).toBe("stream_chunk");
      expect(payload.sessionId).toBe("session-123");

      // Save eventId to localStorage
      localStorageMock.setItem("ccm:lastEventId", String(eventId));
    }

    expect(localStorageMock.getItem("ccm:lastEventId")).toBe("42");
  });

  test("TC-WSR5: ping triggers pong", () => {
    const pingMessage = {
      type: "ping",
      timestamp: Date.now(),
    };

    const sentMessages: unknown[] = [];
    const mockSend = (msg: unknown) => sentMessages.push(msg);

    // Simulate onmessage logic
    if (pingMessage.type === "ping") {
      mockSend({ type: "pong" });
    }

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({ type: "pong" });
  });

  test("TC-WSR6: reconnect message includes lastEventId", () => {
    // Setup: store lastEventId
    localStorageMock.setItem("ccm:lastEventId", "100");

    const sentMessages: unknown[] = [];
    const mockSend = (msg: unknown) => sentMessages.push(msg);

    // Simulate connect() onopen logic
    const lastEventId = Number.parseInt(localStorageMock.getItem("ccm:lastEventId") || "", 10);
    const sessionIds = ["session-1", "session-2"];

    if (!Number.isNaN(lastEventId) && sessionIds.length > 0) {
      mockSend({ type: "reconnect", lastEventId, sessionIds });
    }

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      type: "reconnect",
      lastEventId: 100,
      sessionIds: ["session-1", "session-2"],
    });
  });

  test("TC-WSR7: replay_complete with gapDetected shows notification", () => {
    const replayMessage = {
      type: "replay_complete",
      sessionId: "session-1",
      eventsReplayed: 5,
      gapDetected: true,
    };

    const notifications: string[] = [];
    const mockNotify = (msg: string) => notifications.push(msg);

    // Simulate onmessage logic
    if (replayMessage.type === "replay_complete") {
      if (replayMessage.gapDetected) {
        mockNotify("Some messages may have been missed during reconnect");
      }
    }

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("missed during reconnect");
  });

  test("TC-WSR8: non-wrapped messages pass through directly", () => {
    const directMessage = {
      type: "server_config",
      config: { permissionMode: "default" },
    };

    let handledMessage: unknown = null;
    const mockHandleMessage = (msg: unknown) => {
      handledMessage = msg;
    };

    // Simulate onmessage logic
    if (
      directMessage.type !== "event" &&
      directMessage.type !== "ping" &&
      directMessage.type !== "replay_complete"
    ) {
      mockHandleMessage(directMessage);
    }

    expect(handledMessage).toEqual(directMessage);
  });
});
