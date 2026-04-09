import { beforeEach, describe, expect, test } from "bun:test";
import { debugLog } from "../components/DebugOverlay";

describe("WsService debug logging integration", () => {
  beforeEach(() => {
    debugLog.entries = [];
    debugLog.nextId = 0;
    debugLog.listeners.clear();
  });

  test("debugLog should be called when messages are logged", () => {
    const testMessage = { type: "new_session", cwd: "/test" };
    debugLog.add("send", testMessage);

    expect(debugLog.entries.length).toBe(1);
    expect(debugLog.entries[0].direction).toBe("send");
    expect(debugLog.entries[0].type).toBe("new_session");
    expect(debugLog.entries[0].data).toEqual(testMessage);
  });

  test("should handle receive messages", () => {
    const testMessage = { type: "session_created", sessionId: "test-123" };
    debugLog.add("recv", testMessage);

    expect(debugLog.entries.length).toBe(1);
    expect(debugLog.entries[0].direction).toBe("recv");
    expect(debugLog.entries[0].type).toBe("session_created");
  });

  test("should log both send and receive in order", () => {
    debugLog.add("send", { type: "send", sessionId: "1", content: "hello" });
    debugLog.add("recv", { type: "stream_chunk", sessionId: "1", chunk: {} });
    debugLog.add("send", { type: "permission", requestId: "req-1", allow: true });

    expect(debugLog.entries.length).toBe(3);
    expect(debugLog.entries[0].direction).toBe("send");
    expect(debugLog.entries[1].direction).toBe("recv");
    expect(debugLog.entries[2].direction).toBe("send");
  });

  test("should handle various message types", () => {
    const messageTypes = [
      { type: "new_session", cwd: "/test" },
      { type: "send", sessionId: "1", content: "test" },
      { type: "command", sessionId: "1", command: "/help" },
      { type: "permission", requestId: "1", allow: true },
      { type: "interrupt", sessionId: "1" },
      { type: "list_sessions" },
      { type: "resume_session", sdkSessionId: "sdk-1", cwd: "/test" },
      { type: "set_permission_mode", mode: "auto" },
    ];

    for (const msg of messageTypes) {
      debugLog.add("send", msg);
    }

    expect(debugLog.entries.length).toBe(8);
    expect(debugLog.entries.map((e) => e.type)).toEqual([
      "new_session",
      "send",
      "command",
      "permission",
      "interrupt",
      "list_sessions",
      "resume_session",
      "set_permission_mode",
    ]);
  });
});
