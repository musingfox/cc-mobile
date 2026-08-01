import { describe, expect, test } from "bun:test";
import { SessionManager } from "../session-manager";

describe("SessionManager", () => {
  test("constructor accepts permissionMode", () => {
    expect(() => new SessionManager({ permissionMode: "acceptEdits" })).not.toThrow();
  });

  test("default constructor still works", () => {
    expect(() => new SessionManager({ permissionMode: "default" })).not.toThrow();
  });

  test("createSession rejects a duplicate sessionId", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await mgr.createSession("s1", "/cwd");
    await expect(mgr.createSession("s1", "/cwd")).rejects.toThrow("Session s1 already exists");
  });

  test("destroySession on unknown is no-op", () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    expect(() => mgr.destroySession("unknown")).not.toThrow();
  });

  test("14: setEnvVars stores env vars", () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    mgr.setEnvVars({ NODE_ENV: "test" });
    expect(mgr.getEnvVars()).toEqual({ NODE_ENV: "test" });
  });
});
