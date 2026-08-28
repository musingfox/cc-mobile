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
 *   ServerConfigStillAnswered — the settings screen still gets what the server
 *     alone knows.
 *   RetiredConfigMessagesRefused — the settings that never reached a pane are
 *     now refused by the gate rather than accepted and echoed. They were kept
 *     accepted for a while so the settings UI would not error; the UI that sent
 *     them is gone.
 *
 * Assertions are on the frames the socket actually receives, not on
 * `ServerMessage.parse` output: `get_server_config` replies with a bare
 * `ws.send`.
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

async function start(sessionManager = new SessionManager()) {
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
  test("get_server_config carries only what the server alone knows", async () => {
    const h = await start();

    h.send({ type: "get_server_config" });
    const reply = await h.waitFor((m) => m.type === "server_config");
    const config = reply.config as Record<string, unknown>;

    expect(Object.keys(config).sort()).toEqual([
      "agentProfiles",
      "allowedRoots",
      // Which kinds this machine can launch (#31) — the phone's agent choice
      // comes from here and nowhere else.
      "availableAgents",
      "homeDirectory",
    ]);
    // claude is what cc-mobile itself runs on, so it is always present here.
    expect(config.availableAgents).toContain("claude");
    // An agent's own settings are its own: the server neither sets nor reports
    // them here any more.
    for (const gone of ["permissionMode", "model", "effort"]) {
      expect(Object.hasOwn(config, gone)).toBe(false);
    }
  });
});

describe("RetiredConfigMessagesRefused", () => {
  test.each([
    ["set_model", { type: "set_model", model: "opus" }],
    ["set_effort", { type: "set_effort", effort: "high" }],
    ["set_env_vars", { type: "set_env_vars", envVars: { FOO: "bar" } }],
    ["set_permission_mode", { type: "set_permission_mode", mode: "acceptEdits" }],
  ])("%s is refused by the gate, not echoed", async (_name, message) => {
    const h = await start();

    h.send(message as Record<string, unknown>);

    const reply = await h.waitFor((m) => m.type === "error");
    expect(reply.code).toBe("invalid_message");
  });

  test("append_user_message on a known session raises no error", async () => {
    const sessionManager = new SessionManager();
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
    const sessionManager = new SessionManager();
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
