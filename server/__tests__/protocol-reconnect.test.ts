import { describe, expect, it } from "bun:test";
import { ClientMessage, ServerMessage } from "../protocol";

describe("Reconnect Protocol - Client Messages", () => {
  it("accepts valid reconnect message", () => {
    const result = ClientMessage.parse({
      type: "reconnect",
      lastEventId: 42,
      sessionIds: ["s1", "s2"],
    });
    expect(result.type).toBe("reconnect");
    expect(result.lastEventId).toBe(42);
    expect(result.sessionIds).toEqual(["s1", "s2"]);
  });

  it("accepts reconnect with null lastEventId", () => {
    const result = ClientMessage.parse({
      type: "reconnect",
      lastEventId: null,
      sessionIds: ["s1"],
    });
    expect(result.type).toBe("reconnect");
    expect(result.lastEventId).toBe(null);
    expect(result.sessionIds).toEqual(["s1"]);
  });

  it("rejects reconnect without sessionIds", () => {
    const result = ClientMessage.safeParse({
      type: "reconnect",
      lastEventId: 42,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid pong", () => {
    const result = ClientMessage.parse({ type: "pong" });
    expect(result.type).toBe("pong");
  });
});

describe("Reconnect Protocol - Server Messages", () => {
  it("accepts valid event wrapper", () => {
    const result = ServerMessage.parse({
      type: "event",
      eventId: 1,
      sessionId: "s1",
      payload: { type: "stream_end", sessionId: "s1" },
    });
    expect(result.type).toBe("event");
    expect(result.eventId).toBe(1);
    expect(result.sessionId).toBe("s1");
    expect(result.payload).toEqual({ type: "stream_end", sessionId: "s1" });
  });

  it("accepts valid replay_complete", () => {
    const result = ServerMessage.parse({
      type: "replay_complete",
      sessionId: "s1",
      eventsReplayed: 5,
      gapDetected: false,
    });
    expect(result.type).toBe("replay_complete");
    expect(result.sessionId).toBe("s1");
    expect(result.eventsReplayed).toBe(5);
    expect(result.gapDetected).toBe(false);
  });

  it("accepts valid ping", () => {
    const result = ServerMessage.parse({
      type: "ping",
      timestamp: 1234567890,
    });
    expect(result.type).toBe("ping");
    expect(result.timestamp).toBe(1234567890);
  });
});

describe("Reconnect Protocol - Backward Compatibility", () => {
  it("existing messages still work", () => {
    const result = ClientMessage.parse({
      type: "send",
      sessionId: "s1",
      content: "hello",
    });
    expect(result.type).toBe("send");
    expect(result.sessionId).toBe("s1");
    expect(result.content).toBe("hello");
  });
});
