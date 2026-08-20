import { afterEach, describe, expect, test } from "bun:test";
import { ClientMessage, ServerMessage } from "../protocol";
import { startWsHarness, type WsHarness } from "./ws-harness";

describe("ClientMessage schema", () => {
  // Both answer forms are optional at the schema — a discriminated union cannot
  // express "exactly one of" — so a message carrying neither parses here and is
  // refused by the ws handler instead (see ws-permission-resolve.test.ts).
  test("permission carrying neither answer form parses; the handler refuses it", () => {
    const result = ClientMessage.safeParse({ type: "permission", requestId: "r1" });
    expect(result.success).toBe(true);
  });
  test("permission accepts the server-supplied optionId form", () => {
    const result = ClientMessage.safeParse({ type: "permission", requestId: "r1", optionId: "3" });
    expect(result.success).toBe(true);
  });
  test("permission rejects an empty optionId", () => {
    const result = ClientMessage.safeParse({ type: "permission", requestId: "r1", optionId: "" });
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
  test("get_server_config valid", () => {
    const result = ClientMessage.safeParse({ type: "get_server_config" });
    expect(result.success).toBe(true);
  });

  // set_env_vars and the other agent-settings messages are retired; that they
  // are refused is pinned in protocol-retired-messages.test.ts.

  test("append_user_message valid with string content", () => {
    const result = ClientMessage.safeParse({
      type: "append_user_message",
      sessionId: "s1",
      content: "later note",
    });
    expect(result.success).toBe(true);
  });

  test("append_user_message valid with ContentBlock[]", () => {
    const result = ClientMessage.safeParse({
      type: "append_user_message",
      sessionId: "s1",
      content: [
        { type: "text", text: "note 1" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "abc" },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("append_user_message rejects missing content", () => {
    const result = ClientMessage.safeParse({
      type: "append_user_message",
      sessionId: "s1",
    });
    expect(result.success).toBe(false);
  });

  test("append_user_message rejects missing sessionId", () => {
    const result = ClientMessage.safeParse({
      type: "append_user_message",
      content: "hi",
    });
    expect(result.success).toBe(false);
  });

  test("capabilities_request with a named session parses", () => {
    const result = ClientMessage.safeParse({
      type: "capabilities_request",
      sessionId: "w1:p1",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "capabilities_request") {
      expect(result.data.sessionId).toBe("w1:p1");
      expect(result.data.refresh).toBeUndefined();
    }
  });

  test("capabilities_request accepts refresh:true", () => {
    const result = ClientMessage.safeParse({
      type: "capabilities_request",
      sessionId: "w1:p1",
      refresh: true,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "capabilities_request") {
      expect(result.data.refresh).toBe(true);
    }
  });

  test("capabilities_request without sessionId is refused", () => {
    expect(ClientMessage.safeParse({ type: "capabilities_request" }).success).toBe(false);
  });

  test("capabilities_request with empty sessionId is refused", () => {
    expect(
      ClientMessage.safeParse({ type: "capabilities_request", sessionId: "" }).success,
    ).toBe(false);
  });
});

describe("CapabilitiesRequestAccepted over the socket", () => {
  let harness: WsHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  test("a request that names no session is refused before anything runs", async () => {
    harness = await startWsHarness({});
    harness.send({ type: "capabilities_request" });
    const frame = await harness.waitFor((m) => m.type === "error");
    expect(frame).toEqual({
      type: "error",
      code: "invalid_message",
      message: "Invalid message format",
    });
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
  test("a session descriptor's agent kind survives the parse verbatim", () => {
    const result = ServerMessage.safeParse({
      type: "terminal_sessions",
      sessions: [
        {
          sessionId: "w6C:p1",
          agentSessionValue: null,
          cwd: "/repo",
          origin: "foreign",
          drivable: true,
          readable: false,
          gated: true,
          agent: "omp",
        },
      ],
      claudeUuids: ["w6C:p1"],
    });

    // z.object strips what it does not declare, so an undeclared `agent` would
    // never reach the phone at all — the field has to be in the schema.
    expect(result.success).toBe(true);
    const sessions = result.success && "sessions" in result.data ? result.data.sessions : [];
    expect(sessions[0]?.agent).toBe("omp");
  });

  test("a non-string agent kind is refused", () => {
    const result = ServerMessage.safeParse({
      type: "terminal_sessions",
      sessions: [
        {
          sessionId: "w6C:p1",
          agentSessionValue: null,
          cwd: "/repo",
          origin: "foreign",
          drivable: true,
          readable: false,
          gated: true,
          agent: 42,
        },
      ],
      claudeUuids: ["w6C:p1"],
    });

    expect(result.success).toBe(false);
  });

  test("server_config drops an agent-settings field it no longer carries", () => {
    const result = ServerMessage.safeParse({
      type: "server_config",
      config: { homeDirectory: "/home/u", permissionMode: "acceptEdits" },
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== "server_config") return;
    expect(Object.hasOwn(result.data.config, "permissionMode")).toBe(false);
  });
});
