import { describe, expect, test } from "bun:test";
import { parseServerConfig } from "../config";

describe("parseServerConfig", () => {
  const originalEnv = process.env.CC_MOBILE_ALLOWED_ROOTS;

  // Clean up after each test
  const cleanup = () => {
    if (originalEnv === undefined) {
      delete process.env.CC_MOBILE_ALLOWED_ROOTS;
    } else {
      process.env.CC_MOBILE_ALLOWED_ROOTS = originalEnv;
    }
  };

  test("defaults", () => {
    delete process.env.CC_MOBILE_ALLOWED_ROOTS;
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result).toEqual({
      port: 3001,
      hostname: "0.0.0.0",
      defaultCwd: null,
      permissionMode: "default",
      allowedRoots: null,
    });
    cleanup();
  });

  test("all flags", () => {
    delete process.env.CC_MOBILE_ALLOWED_ROOTS;
    const result = parseServerConfig([
      "node",
      "index.ts",
      "--port",
      "4000",
      "--permission-mode",
      "acceptEdits",
      "--default-cwd",
      "/workspace",
    ]);
    expect(result).toEqual({
      port: 4000,
      hostname: "0.0.0.0",
      defaultCwd: "/workspace",
      permissionMode: "acceptEdits",
      allowedRoots: null,
    });
    cleanup();
  });

  test("invalid permission-mode", () => {
    expect(() => {
      parseServerConfig(["node", "index.ts", "--permission-mode", "invalid"]);
    }).toThrow(
      "Invalid permission-mode: invalid. Allowed: default, acceptEdits, bypassPermissions",
    );
  });

  test("invalid port", () => {
    expect(() => {
      parseServerConfig(["node", "index.ts", "--port", "abc"]);
    }).toThrow("Port must be a valid number");
  });
});
