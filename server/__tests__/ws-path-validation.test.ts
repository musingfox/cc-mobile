import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("WebSocket path validation integration", () => {
  const originalEnv = process.env.CLAUDE_MOBILE_ALLOWED_ROOTS;

  beforeAll(() => {
    // Set up restricted paths for testing
    process.env.CLAUDE_MOBILE_ALLOWED_ROOTS = "/allowed/path,/another/allowed";
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_MOBILE_ALLOWED_ROOTS;
    } else {
      process.env.CLAUDE_MOBILE_ALLOWED_ROOTS = originalEnv;
    }
  });

  test("config reflects environment variable", () => {
    const { parseServerConfig } = require("../config");
    const config = parseServerConfig(["node", "index.ts"]);

    expect(config.allowedRoots).toEqual([resolve("/allowed/path"), resolve("/another/allowed")]);
  });

  test("no restriction when env var is not set", () => {
    delete process.env.CLAUDE_MOBILE_ALLOWED_ROOTS;
    const { parseServerConfig } = require("../config");
    const config = parseServerConfig(["node", "index.ts"]);

    expect(config.allowedRoots).toBe(null);

    // Restore for other tests
    process.env.CLAUDE_MOBILE_ALLOWED_ROOTS = "/allowed/path,/another/allowed";
  });
});
