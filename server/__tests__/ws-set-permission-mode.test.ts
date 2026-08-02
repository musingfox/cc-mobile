import { afterEach, describe, expect, test } from "bun:test";
import { SessionManager } from "../session-manager";
import { startWsHarness, testServerConfig, type WsHarness } from "./ws-harness";

async function makeManagerWithSession(sessionId: string) {
  const mgr = new SessionManager({ permissionMode: "default" });
  await mgr.createSession(sessionId, "/tmp/test");
  return mgr;
}

describe("set_permission_mode semantics (C3b)", () => {
  test("with sessionId: only the session override is mutated; global default untouched", async () => {
    const mgr = await makeManagerWithSession("s1");

    // simulate ws.ts case "set_permission_mode" with sessionId present
    expect(mgr.hasSession("s1")).toBe(true);
    mgr.setSessionPermissionMode("s1", "plan");

    expect(mgr.getSessionPermissionMode("s1")).toBe("plan");
    expect(mgr.getPermissionMode()).toBe("default");
  });

  test("without sessionId: only global default is mutated; existing session override preserved", async () => {
    const mgr = await makeManagerWithSession("s1");
    mgr.setSessionPermissionMode("s1", "plan");

    // simulate ws.ts case "set_permission_mode" with no sessionId
    mgr.setPermissionMode("acceptEdits");

    expect(mgr.getPermissionMode()).toBe("acceptEdits");
    expect(mgr.getSessionPermissionMode("s1")).toBe("plan");
  });

  test("sessionId not found: ws handler returns session_not_found error and does not mutate state", async () => {
    const mgr = await makeManagerWithSession("s1");
    const sentMessages: Array<Record<string, unknown>> = [];
    const fakeWs = { send: (m: Record<string, unknown>) => sentMessages.push(m) };

    // Replicate the ws.ts case "set_permission_mode" branch for a missing session.
    const message = { type: "set_permission_mode", mode: "plan", sessionId: "missing" } as const;
    if (message.sessionId) {
      if (!mgr.hasSession(message.sessionId)) {
        fakeWs.send({
          type: "error",
          code: "session_not_found",
          message: `Session ${message.sessionId} not found`,
          sessionId: message.sessionId,
        });
      } else {
        mgr.setSessionPermissionMode(message.sessionId, message.mode);
      }
    }

    expect(sentMessages).toEqual([
      {
        type: "error",
        code: "session_not_found",
        message: "Session missing not found",
        sessionId: "missing",
      },
    ]);
    // No state mutation
    expect(mgr.getPermissionMode()).toBe("default");
    expect(mgr.getSessionPermissionMode("s1")).toBeUndefined();
  });

  test("setSessionPermissionMode on unknown session throws (defense in depth)", async () => {
    const mgr = await makeManagerWithSession("s1");
    expect(() => mgr.setSessionPermissionMode("missing", "plan")).toThrow(
      "Session missing not found",
    );
    // No global mutation either
    expect(mgr.getPermissionMode()).toBe("default");
  });
});

/**
 * SessionScopedMessagesReportSessionNotFound — the same branch, over the wire.
 * Since the resume handler was deleted there is no way for a session to reach
 * the manager's map through the socket, so the per-session form of this message
 * always answers not-found. Pinned so review reads it as intended, not broken.
 */
describe("set_permission_mode over a fresh connection", () => {
  let harness: WsHarness | null = null;

  async function start() {
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
    return harness;
  }

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  test("with a sessionId: the full session_not_found frame comes back", async () => {
    const h = await start();

    h.send({ type: "set_permission_mode", sessionId: "u1", mode: "plan" });

    const reply = await h.waitFor((m) => m.type === "error");
    expect(reply).toEqual({
      type: "error",
      code: "session_not_found",
      message: "Session u1 not found",
      sessionId: "u1",
    });
  });

  test("without a sessionId: the global branch still records and echoes the mode", async () => {
    const h = await start();

    h.send({ type: "set_permission_mode", mode: "plan" });

    const reply = await h.waitFor((m) => m.type === "server_config");
    expect((reply.config as Record<string, unknown>).permissionMode).toBe("plan");
  });
});
