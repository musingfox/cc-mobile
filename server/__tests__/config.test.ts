import { afterEach, describe, expect, test } from "bun:test";
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
    delete process.env.BASE_PATH;
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result).toEqual({
      port: 3001,
      hostname: "0.0.0.0",
      defaultCwd: null,
      allowedRoots: null,
      basePath: "",
      pushScope: "phone-last",
    });
    cleanup();
  });

  test("all flags", () => {
    delete process.env.CC_MOBILE_ALLOWED_ROOTS;
    delete process.env.BASE_PATH;
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
      allowedRoots: null,
      basePath: "",
      pushScope: "phone-last",
    });
    cleanup();
  });

  test("invalid port", () => {
    expect(() => {
      parseServerConfig(["node", "index.ts", "--port", "abc"]);
    }).toThrow("Port must be a valid number");
  });

  describe("CC_MOBILE_PUSH_SCOPE", () => {
    const original = process.env.CC_MOBILE_PUSH_SCOPE;

    afterEach(() => {
      if (original === undefined) delete process.env.CC_MOBILE_PUSH_SCOPE;
      else process.env.CC_MOBILE_PUSH_SCOPE = original;
    });

    test("unset means phone-last", () => {
      delete process.env.CC_MOBILE_PUSH_SCOPE;
      expect(parseServerConfig(["node", "index.ts"]).pushScope).toBe("phone-last");
    });

    test("all is accepted", () => {
      process.env.CC_MOBILE_PUSH_SCOPE = "all";
      expect(parseServerConfig(["node", "index.ts"]).pushScope).toBe("all");
    });

    test("a typo throws instead of silently defaulting", () => {
      // Falling back would leave the operator believing they had switched
      // something on, and a push that never arrives is already the hardest
      // failure here to see.
      process.env.CC_MOBILE_PUSH_SCOPE = "always";
      expect(() => parseServerConfig(["node", "index.ts"])).toThrow("CC_MOBILE_PUSH_SCOPE");
    });
  });
});
