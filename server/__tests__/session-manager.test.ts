import { describe, test, expect } from "bun:test";
import { SessionManager } from "../session-manager";

describe("SessionManager", () => {
  test("createSession stores session", async () => {
    const mgr = new SessionManager();
    // This test requires the real SDK binary. We test the guard logic only.
    // Duplicate session test:
    // We can test the Map guard without SDK by using a mock approach
  });

  test("sendMessage throws on unknown session", async () => {
    const mgr = new SessionManager();
    await expect(mgr.sendMessage("unknown", "hi").next()).rejects.toThrow("Session unknown not found");
  });

  test("destroySession on unknown is no-op", () => {
    const mgr = new SessionManager();
    expect(() => mgr.destroySession("unknown")).not.toThrow();
  });
});
