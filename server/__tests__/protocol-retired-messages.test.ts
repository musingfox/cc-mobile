/**
 * protocol-retired-messages.test.ts — RetiredMessageTypesRejected and
 * RetiredHistoryMessagesRejected.
 *
 * #25 removed the SDK query path and the messages that only ever fed it; #26
 * removed the browse-past-conversations path on top of it; the agent-settings
 * controls followed, once it was settled that an agent's mode, model and effort
 * are the agent's own settings rather than cc-mobile's to decide. There
 * is no compatibility window (plan D4): a stale bundle sending an old name is
 * refused by the Zod gate and gets `{code:"invalid_message"}` back, which the
 * client already surfaces. The failure is loud, and the user's fix is a reload.
 *
 * `session_state` is the control case — it looks like it belongs to the deleted
 * set but is emitted by the live `herdr/status-events.ts`, so deleting it would
 * silently break the activity indicator.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ClientMessage, ServerMessage } from "../protocol";
import { SessionManager } from "../session-manager";
import { startWsHarness, testServerConfig, type WsHarness } from "./ws-harness";

describe("RetiredMessageTypesRejected", () => {
  test.each([
    ["new_session", { type: "new_session", cwd: "/p" }],
    ["send", { type: "send", sessionId: "s", content: "hi" }],
    ["command", { type: "command", sessionId: "s", command: "/help" }],
    ["pty_send", { type: "pty_send", sessionId: "s", cwd: "/p", prompt: "hi" }],
    ["get_session_info", { type: "get_session_info", sessionId: "s" }],
    // The old backend-named trio a cached bundle would still be sending.
    ["tmux_create", { type: "tmux_create", claudeUuid: "u1", cwd: "/p" }],
    ["tmux_send", { type: "tmux_send", claudeUuid: "u1", content: "hi" }],
    ["tmux_teardown", { type: "tmux_teardown", claudeUuid: "u1" }],
    // #26: browsing past conversations is gone end to end.
    ["list_sessions", { type: "list_sessions", dir: "/x", limit: 20, offset: 0 }],
    ["resume_session", { type: "resume_session", sdkSessionId: "abc", cwd: "/x" }],
    [
      "set_session_title",
      { type: "set_session_title", sdkSessionId: "abc", title: "t", dir: "/x" },
    ],
    // The agent-settings controls. They were accepted and echoed long after
    // they stopped reaching anything, purely so the settings UI would not error
    // at the user; that UI is gone too.
    ["set_permission_mode", { type: "set_permission_mode", mode: "acceptEdits" }],
    ["set_model", { type: "set_model", model: "opus" }],
    ["set_effort", { type: "set_effort", effort: "high" }],
    ["set_env_vars", { type: "set_env_vars", envVars: { FOO: "bar" } }],
  ])("client message %s no longer parses", (_name, payload) => {
    expect(ClientMessage.safeParse(payload).success).toBe(false);
  });

  test.each([
    ["result", { type: "result", sessionId: "s", success: true }],
    ["session_info", { type: "session_info", session: null }],
    ["session_list", { type: "session_list", sessions: [] }],
    ["session_history", { type: "session_history", sessionId: "s", messages: [] }],
    ["session_created", { type: "session_created", sessionId: "s", cwd: "/x" }],
  ])("server message %s no longer parses", (_name, payload) => {
    expect(ServerMessage.safeParse(payload).success).toBe(false);
  });

  test("control: session_state is a surviving member and still parses", () => {
    const result = ServerMessage.safeParse({
      type: "session_state",
      sessionId: "u1",
      state: "running",
    });
    expect(result.success).toBe(true);
  });
});

describe("LegacyCapabilitiesMessageRefused", () => {
  test("the retired capabilities snapshot no longer parses", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      commands: ["help"],
      agents: ["Explore"],
      model: "claude-sonnet-4-6",
    });
    expect(result.success).toBe(false);
  });

  test("capabilities_list with named session and object lists parses", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities_list",
      sessionId: "s1",
      commands: [{ name: "help" }],
      agents: [{ name: "Explore" }],
    });
    expect(result.success).toBe(true);
  });

  test("capabilities_list carries argumentHint on a command", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities_list",
      sessionId: "s1",
      commands: [{ name: "help", description: "H", argumentHint: "<x>" }],
      agents: [],
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "capabilities_list") {
      expect(result.data.commands[0].argumentHint).toBe("<x>");
    }
  });

  test("capabilities_list without sessionId is refused", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities_list",
      commands: [],
      agents: [],
    });
    expect(result.success).toBe(false);
  });
});

/**
 * The socket-level half. It lives here rather than in a ws-* test file because
 * this file is one of the residue scan's two by-name exclusions, and the case
 * cannot be written without spelling a retired name.
 */
describe("RetiredHistoryMessagesRejected over the socket", () => {
  let harness: WsHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  test("a retired history request gets one error frame and the socket stays open", async () => {
    harness = await startWsHarness(
      {
        createSession: async () => ({ name: "n", paneRef: "p1" }),
        teardown: async () => ({ killed: false }),
        listLive: () => [],
        send: async () => {},
        registerClient: () => {},
        cleanupByOwner: () => {},
      },
      testServerConfig,
      { sessionManager: new SessionManager() },
    );

    harness.send({ type: "list_sessions" });

    const reply = await harness.waitFor((m) => m.type === "error");
    expect(reply.code).toBe("invalid_message");

    // Still usable afterwards — and exactly one error frame, not a storm.
    harness.send({ type: "get_server_config" });
    await harness.waitFor((m) => m.type === "server_config");
    expect(harness.received.filter((m) => m.type === "error")).toHaveLength(1);
  });
});
