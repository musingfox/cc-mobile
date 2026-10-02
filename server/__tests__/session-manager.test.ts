import { describe, expect, test } from "bun:test";
import { SessionManager } from "../session-manager";

describe("SessionManager", () => {
  test("constructs with no settings at all", () => {
    expect(() => new SessionManager()).not.toThrow();
  });

  test("destroySession on unknown is no-op", () => {
    const mgr = new SessionManager();
    expect(() => mgr.destroySession("unknown")).not.toThrow();
  });
});
