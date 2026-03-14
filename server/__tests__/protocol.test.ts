import { describe, test, expect } from "bun:test";
import { ClientMessage, ServerMessage } from "../protocol";

describe("ClientMessage schema", () => {
  test("new_session valid", () => {
    const result = ClientMessage.safeParse({ type: "new_session", cwd: "/tmp" });
    expect(result.success).toBe(true);
  });
  test("send valid", () => {
    const result = ClientMessage.safeParse({ type: "send", sessionId: "s1", content: "hello" });
    expect(result.success).toBe(true);
  });
  test("permission missing allow field", () => {
    const result = ClientMessage.safeParse({ type: "permission", requestId: "r1" });
    expect(result.success).toBe(false);
  });
  test("permission valid", () => {
    const result = ClientMessage.safeParse({ type: "permission", requestId: "r1", allow: true });
    expect(result.success).toBe(true);
  });
});

describe("ServerMessage schema", () => {
  test("stream_chunk valid", () => {
    const result = ServerMessage.safeParse({ type: "stream_chunk", sessionId: "s1", chunk: { text: "hi" } });
    expect(result.success).toBe(true);
  });
  test("permission_request valid", () => {
    const result = ServerMessage.safeParse({
      type: "permission_request", sessionId: "s1", requestId: "r1",
      tool: { name: "Read", parameters: { file_path: "/a" } }
    });
    expect(result.success).toBe(true);
  });
  test("error valid", () => {
    const result = ServerMessage.safeParse({ type: "error", code: "session_error", message: "not found" });
    expect(result.success).toBe(true);
  });
});
