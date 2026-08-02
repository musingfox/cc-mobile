import { afterEach, describe, expect, test } from "bun:test";
import { SessionManager } from "../session-manager";
import { startWsHarness, testServerConfig, type WsHarness } from "./ws-harness";

/**
 * C3 — WS handler for `append_user_message`. We exercise the branch logic
 * inline with a fake `ws` and a stub `sessionManager.appendUserMessage`, so
 * the test does not need to spin up an Elysia server.
 */

type FakeWs = { send: (m: Record<string, unknown>) => void };

function runAppendCase(
  appendImpl: (sessionId: string, content: string) => void,
  message: { type: "append_user_message"; sessionId: string; content: string },
) {
  const sent: Array<Record<string, unknown>> = [];
  const ws: FakeWs = { send: (m) => sent.push(m) };
  const sessionManager = { appendUserMessage: appendImpl };

  // Mirror the case "append_user_message" branch from server/ws.ts
  try {
    sessionManager.appendUserMessage(message.sessionId, message.content);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const code = errMsg.includes("not found")
      ? "session_not_found"
      : errMsg === "append_buffer_full"
        ? "append_buffer_full"
        : "append_failed";
    ws.send({
      type: "error",
      code,
      message: errMsg,
      sessionId: message.sessionId,
    });
  }

  return sent;
}

describe("WS append_user_message handler", () => {
  test("success: handler sends no frame", () => {
    let called = 0;
    const sent = runAppendCase(
      () => {
        called += 1;
      },
      { type: "append_user_message", sessionId: "s1", content: "note" },
    );
    expect(called).toBe(1);
    expect(sent).toEqual([]);
  });

  test("session missing: emits error with code session_not_found", () => {
    const sent = runAppendCase(
      () => {
        throw new Error("Session s-x not found");
      },
      { type: "append_user_message", sessionId: "s-x", content: "note" },
    );
    expect(sent).toEqual([
      {
        type: "error",
        code: "session_not_found",
        message: "Session s-x not found",
        sessionId: "s-x",
      },
    ]);
  });

  test("buffer full: emits error with code append_buffer_full", () => {
    const sent = runAppendCase(
      () => {
        throw new Error("append_buffer_full");
      },
      { type: "append_user_message", sessionId: "s1", content: "note" },
    );
    expect(sent).toEqual([
      {
        type: "error",
        code: "append_buffer_full",
        message: "append_buffer_full",
        sessionId: "s1",
      },
    ]);
  });

  test("other error: falls back to code append_failed", () => {
    const sent = runAppendCase(
      () => {
        throw new Error("something else went wrong");
      },
      { type: "append_user_message", sessionId: "s1", content: "note" },
    );
    expect(sent).toEqual([
      {
        type: "error",
        code: "append_failed",
        message: "something else went wrong",
        sessionId: "s1",
      },
    ]);
  });
});

/**
 * SessionScopedMessagesReportSessionNotFound — the real socket answer now that
 * nothing registers a session server-side any more. The simulated cases above
 * pin the branch logic; this pins what the phone actually receives.
 */
describe("append_user_message over a fresh connection", () => {
  let harness: WsHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  test("answers a typed session_not_found instead of appearing to succeed", async () => {
    harness = await startWsHarness(
      {
        createSession: async () => ({ name: "n", paneRef: "p1", settingsPath: "/tmp/s" }),
        teardown: async () => ({ killed: false }),
        listLive: () => [],
        send: async () => {},
        registerClient: () => {},
        cleanupByOwner: () => {},
      },
      testServerConfig,
      { sessionManager: new SessionManager({ permissionMode: "default" }) },
    );

    harness.send({ type: "append_user_message", sessionId: "u1", content: "hi" });

    const reply = await harness.waitFor((m) => m.type === "error");
    expect(reply).toEqual({
      type: "error",
      code: "session_not_found",
      message: "Session u1 not found",
      sessionId: "u1",
    });
  });
});
