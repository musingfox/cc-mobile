/**
 * protocol-retired-messages.test.ts — RetiredMessageTypesRejected.
 *
 * #25 removed the SDK query path and the messages that only ever fed it. There
 * is no compatibility window (plan D4): a stale bundle sending an old name is
 * refused by the Zod gate and gets `{code:"invalid_message"}` back, which the
 * client already surfaces. The failure is loud, and the user's fix is a reload.
 *
 * `session_state` is the control case — it looks like it belongs to the deleted
 * set but is emitted by the live `herdr/status-events.ts`, so deleting it would
 * silently break the activity indicator.
 */

import { describe, expect, test } from "bun:test";
import { ClientMessage, ServerMessage } from "../protocol";

describe("RetiredMessageTypesRejected", () => {
  test.each([
    ["new_session", { type: "new_session", cwd: "/p" }],
    ["send", { type: "send", sessionId: "s", content: "hi" }],
    ["command", { type: "command", sessionId: "s", command: "/help" }],
    ["pty_send", { type: "pty_send", sessionId: "s", cwd: "/p", prompt: "hi" }],
    ["get_session_info", { type: "get_session_info", sessionId: "s" }],
  ])("client message %s no longer parses", (_name, payload) => {
    expect(ClientMessage.safeParse(payload).success).toBe(false);
  });

  test.each([
    ["result", { type: "result", sessionId: "s", success: true }],
    ["session_info", { type: "session_info", session: null }],
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
