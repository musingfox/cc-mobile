import { describe, expect, test } from "bun:test";
import { SessionManager } from "../session-manager";

describe("SessionManager", () => {
  test("constructs with no settings at all", () => {
    expect(() => new SessionManager()).not.toThrow();
  });

  test("createSession rejects a duplicate sessionId", async () => {
    const mgr = new SessionManager();
    await mgr.createSession("s1", "/cwd");
    await expect(mgr.createSession("s1", "/cwd")).rejects.toThrow("Session s1 already exists");
  });

  test("destroySession on unknown is no-op", () => {
    const mgr = new SessionManager();
    expect(() => mgr.destroySession("unknown")).not.toThrow();
  });
});
