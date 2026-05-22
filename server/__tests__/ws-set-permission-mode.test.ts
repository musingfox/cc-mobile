import { describe, expect, test } from "bun:test";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { SessionManager } from "../session-manager";

const noopCanUseTool: CanUseTool = (async () => {
  return { behavior: "deny", message: "test" };
}) as unknown as CanUseTool;

async function makeManagerWithSession(sessionId: string) {
  const mgr = new SessionManager({ permissionMode: "default" });
  await mgr.createSession(sessionId, "/tmp/test", noopCanUseTool);
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
