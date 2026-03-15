import { describe, test, expect } from "bun:test";
import { parseServerConfig } from "../config";

describe("parseServerConfig", () => {
  test("defaults", () => {
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result).toEqual({
      port: 3001,
      hostname: "0.0.0.0",
      defaultCwd: null,
      permissionMode: "default",
    });
  });

  test("all flags", () => {
    const result = parseServerConfig([
      "node", "index.ts",
      "--port", "4000",
      "--permission-mode", "acceptEdits",
      "--default-cwd", "/workspace"
    ]);
    expect(result).toEqual({
      port: 4000,
      hostname: "0.0.0.0",
      defaultCwd: "/workspace",
      permissionMode: "acceptEdits",
    });
  });

  test("invalid permission-mode", () => {
    expect(() => {
      parseServerConfig(["node", "index.ts", "--permission-mode", "invalid"]);
    }).toThrow("Invalid permission-mode: invalid. Allowed: default, acceptEdits, bypassPermissions");
  });

  test("invalid port", () => {
    expect(() => {
      parseServerConfig(["node", "index.ts", "--port", "abc"]);
    }).toThrow("Port must be a valid number");
  });
});
