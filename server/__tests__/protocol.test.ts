import { describe, expect, test } from "bun:test";
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
  test("PermissionMessage accepts answers field", () => {
    const result = ClientMessage.safeParse({
      type: "permission",
      requestId: "r1",
      allow: true,
      answers: { "Which language?": "Python" },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "permission") {
      expect(result.data).toEqual({
        type: "permission",
        requestId: "r1",
        allow: true,
        answers: { "Which language?": "Python" },
      });
    }
  });
  test("PermissionMessage works without answers", () => {
    const result = ClientMessage.safeParse({ type: "permission", requestId: "r1", allow: true });
    expect(result.success).toBe(true);
  });
  test("command valid", () => {
    const result = ClientMessage.safeParse({
      type: "command",
      sessionId: "s1",
      command: "/commit",
    });
    expect(result.success).toBe(true);
  });
  test("command missing command field", () => {
    const result = ClientMessage.safeParse({ type: "command", sessionId: "s1" });
    expect(result.success).toBe(false);
  });
  test("get_server_config valid", () => {
    const result = ClientMessage.safeParse({ type: "get_server_config" });
    expect(result.success).toBe(true);
  });

  test("T7: list_sessions valid", () => {
    const result = ClientMessage.safeParse({ type: "list_sessions", limit: 10 });
    expect(result.success).toBe(true);
  });

  test("list_sessions with all options", () => {
    const result = ClientMessage.safeParse({
      type: "list_sessions",
      dir: "/test/dir",
      limit: 20,
      offset: 5,
    });
    expect(result.success).toBe(true);
  });

  test("list_sessions minimal (no options)", () => {
    const result = ClientMessage.safeParse({ type: "list_sessions" });
    expect(result.success).toBe(true);
  });

  test("T8: resume_session valid", () => {
    const result = ClientMessage.safeParse({
      type: "resume_session",
      sdkSessionId: "abc",
      cwd: "/test",
    });
    expect(result.success).toBe(true);
  });

  test("resume_session missing sdkSessionId", () => {
    const result = ClientMessage.safeParse({
      type: "resume_session",
      cwd: "/test",
    });
    expect(result.success).toBe(false);
  });

  test("resume_session missing cwd", () => {
    const result = ClientMessage.safeParse({
      type: "resume_session",
      sdkSessionId: "abc",
    });
    expect(result.success).toBe(false);
  });

  test("12: set_env_vars valid", () => {
    const result = ClientMessage.safeParse({ type: "set_env_vars", envVars: { A: "1" } });
    expect(result.success).toBe(true);
  });

  test("13: set_env_vars with invalid envVars fails", () => {
    const result = ClientMessage.safeParse({ type: "set_env_vars", envVars: ["invalid"] });
    expect(result.success).toBe(false);
  });
});

describe("ServerMessage schema", () => {
  test("stream_chunk with SDK message structure", () => {
    const result = ServerMessage.safeParse({
      type: "stream_chunk",
      sessionId: "s1",
      chunk: { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
    });
    expect(result.success).toBe(true);
  });
  test("capabilities valid", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      commands: ["commit", "review-pr"],
      agents: ["Explore"],
      model: "claude-sonnet-4-6",
    });
    expect(result.success).toBe(true);
  });
  test("permission_request valid", () => {
    const result = ServerMessage.safeParse({
      type: "permission_request",
      sessionId: "s1",
      requestId: "r1",
      tool: { name: "Read", parameters: { file_path: "/a" } },
    });
    expect(result.success).toBe(true);
  });
  test("error valid", () => {
    const result = ServerMessage.safeParse({
      type: "error",
      code: "session_error",
      message: "not found",
    });
    expect(result.success).toBe(true);
  });
  test("server_config valid", () => {
    const result = ServerMessage.safeParse({
      type: "server_config",
      config: { permissionMode: "default" },
    });
    expect(result.success).toBe(true);
  });
  test("server_config invalid permissionMode", () => {
    const result = ServerMessage.safeParse({
      type: "server_config",
      config: { permissionMode: "invalid" },
    });
    expect(result.success).toBe(false);
  });
});
