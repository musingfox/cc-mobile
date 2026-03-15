import { describe, expect, test } from "bun:test";
import { SessionManager } from "../session-manager";

describe("SessionManager", () => {
  test("constructor accepts permissionMode", () => {
    expect(() => new SessionManager({ permissionMode: "acceptEdits" })).not.toThrow();
  });

  test("default constructor still works", () => {
    expect(() => new SessionManager({ permissionMode: "default" })).not.toThrow();
  });

  test("sendMessage throws on unknown session", async () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    await expect(mgr.sendMessage("unknown", "hi").next()).rejects.toThrow(
      "Session unknown not found",
    );
  });

  test("destroySession on unknown is no-op", () => {
    const mgr = new SessionManager({ permissionMode: "default" });
    expect(() => mgr.destroySession("unknown")).not.toThrow();
  });
});
