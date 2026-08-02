/**
 * ws-surviving-messages.test.ts — what a connection can still do after the SDK
 * query path was removed (#25).
 *
 * Three contracts share one harness here because they share one precondition:
 *   WsRoutingWithoutPermissionHandler — the bridge's internal-error guard sat
 *     ahead of every case and died with the bridge; a fresh connection's very
 *     first message must be answered. (The source-level half of that contract —
 *     that the guard's message string is gone tree-wide — is asserted in
 *     dead-code-residue.test.ts.)
 *   ServerConfigStillAnswered — the settings screen still gets all five fields.
 *   NoOpConfigMessagesAccepted — the settings that no longer reach a pane are
 *     still *accepted*, not rejected. Pinned deliberately (plan D3) so this
 *     no-op state reads as intentional rather than as a regression.
 *
 * Assertions are on the frames the socket actually receives, not on
 * `ServerMessage.parse` output: `get_server_config` replies with a bare
 * `ws.send`, and the schema's `config` object would strip `model` / `effort`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { SessionManager } from "../session-manager";
import { startWsHarness, testServerConfig, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const backendStub = {
  createSession: async () => ({ name: "n", paneRef: "p1" }),
  teardown: async () => ({ killed: false }),
  listLive: () => [],
  send: async () => {},
  registerClient: () => {},
  cleanupByOwner: () => {},
};

async function start(sessionManager = new SessionManager({ permissionMode: "default" })) {
  harness = await startWsHarness(backendStub, testServerConfig, { sessionManager });
  return harness;
}

/** Any frame carrying an error code, whatever the reason. */
function errorFrames(h: WsHarness) {
  return h.received.filter((m) => m.type === "error");
}

describe("WsRoutingWithoutPermissionHandler", () => {
  test("a brand-new connection's first message is answered, not blocked", async () => {
    const h = await start();

    // The probe used to be the session listing; that message is gone, so this
    // asks the other connection-scoped question that is answered immediately.
    h.send({ type: "get_server_config" });

    const reply = await h.waitFor((m) => m.type === "server_config");
    expect(reply.type).toBe("server_config");
    expect(errorFrames(h)).toEqual([]);
  });

  // The "no source file still carries the guard's message" half of this
  // contract is asserted tree-wide in dead-code-residue.test.ts, which already
  // walks every file under server/ and client/.
});

describe("ServerConfigStillAnswered", () => {
  test("get_server_config carries all five fields", async () => {
    const h = await start();

    h.send({ type: "get_server_config" });
    const reply = await h.waitFor((m) => m.type === "server_config");
    const config = reply.config as Record<string, unknown>;

    expect(config.permissionMode).toBe("default");
    expect(Object.keys(config).sort()).toEqual([
      "allowedRoots",
      "effort",
      "homeDirectory",
      "model",
      "permissionMode",
    ]);
  });
});

describe("NoOpConfigMessagesAccepted", () => {
  test("set_model echoes the new model back and raises no error", async () => {
    const h = await start();

    h.send({ type: "set_model", model: "opus" });

    const reply = await h.waitFor((m) => m.type === "server_config");
    expect((reply.config as Record<string, unknown>).model).toBe("opus");
    expect(errorFrames(h)).toEqual([]);
  });

  test("set_effort echoes the new effort back and raises no error", async () => {
    const h = await start();

    h.send({ type: "set_effort", effort: "high" });

    const reply = await h.waitFor((m) => m.type === "server_config");
    expect((reply.config as Record<string, unknown>).effort).toBe("high");
    expect(errorFrames(h)).toEqual([]);
  });

  test("set_env_vars is accepted silently — no reply, no error", async () => {
    const h = await start();

    h.send({ type: "set_env_vars", envVars: { FOO: "bar" } });
    // Round-trip a message that does reply, to prove the first one was processed.
    h.send({ type: "get_server_config" });
    await h.waitFor((m) => m.type === "server_config");

    expect(errorFrames(h)).toEqual([]);
  });

  test("set_permission_mode without a sessionId echoes the mode back", async () => {
    const h = await start();

    h.send({ type: "set_permission_mode", mode: "acceptEdits" });

    const reply = await h.waitFor((m) => m.type === "server_config");
    expect((reply.config as Record<string, unknown>).permissionMode).toBe("acceptEdits");
    expect(errorFrames(h)).toEqual([]);
  });

  test("set_permission_mode for an unknown sessionId still errors (kept behaviour)", async () => {
    const h = await start();

    h.send({ type: "set_permission_mode", mode: "plan", sessionId: "ghost" });

    const reply = await h.waitFor((m) => m.type === "error");
    expect(reply.code).toBe("session_not_found");
  });

  test("append_user_message on a known session raises no error", async () => {
    const sessionManager = new SessionManager({ permissionMode: "default" });
    await sessionManager.createSession("s1", "/tmp");
    const h = await start(sessionManager);

    h.send({ type: "append_user_message", sessionId: "s1", content: "hi" });
    h.send({ type: "get_server_config" });
    await h.waitFor((m) => m.type === "server_config");

    expect(errorFrames(h)).toEqual([]);
  });
});

describe("StopTaskReportsNoActiveQuery", () => {
  test("stop_task on a known session answers no_active_query", async () => {
    const sessionManager = new SessionManager({ permissionMode: "default" });
    await sessionManager.createSession("s1", "/tmp");
    const h = await start(sessionManager);

    h.send({ type: "stop_task", sessionId: "s1", taskId: "t1" });

    // The error rides inside a buffered `event` envelope.
    const envelope = await h.waitFor(
      (m) => m.type === "event" && (m.payload as Record<string, unknown>)?.type === "error",
    );
    const payload = envelope.payload as Record<string, unknown>;
    expect(payload.code).toBe("no_active_query");
    expect(payload.sessionId).toBe("s1");
  });

  test("stop_task on an unknown session answers the same way, without throwing", async () => {
    const h = await start();

    h.send({ type: "stop_task", sessionId: "ghost", taskId: "t1" });

    const envelope = await h.waitFor(
      (m) => m.type === "event" && (m.payload as Record<string, unknown>)?.type === "error",
    );
    expect((envelope.payload as Record<string, unknown>).code).toBe("no_active_query");
  });
});

describe("InterruptWithoutSessionIsSilentNoOp", () => {
  test("interrupting a session the server never registered emits nothing at all", async () => {
    // The session map has had no writer since the resume handler was deleted,
    // so this deletes nothing — and unlike the settings messages it must not
    // put an error bubble in the chat either.
    const h = await start();

    h.send({ type: "interrupt", sessionId: "u1" });
    // Barrier: a message that does reply, proving the interrupt was processed.
    h.send({ type: "get_server_config" });
    await h.waitFor((m) => m.type === "server_config");

    expect(errorFrames(h)).toEqual([]);
  });
});

describe("RetiredMessageTypesRejected", () => {
  test("a retired message name is refused with invalid_message, connection stays open", async () => {
    const h = await start();

    h.send({ type: "new_session", cwd: "/tmp" });

    const reply = await h.waitFor((m) => m.type === "error");
    expect(reply.code).toBe("invalid_message");

    // Still usable afterwards.
    h.send({ type: "get_server_config" });
    await h.waitFor((m) => m.type === "server_config");
  });
});
