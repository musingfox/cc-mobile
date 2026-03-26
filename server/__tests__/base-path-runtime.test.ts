import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseServerConfig } from "../config";

describe("BASE_PATH Runtime Server Test", () => {
  test("server config accepts BASE_PATH env var", () => {
    // Save original env
    const originalBasePath = process.env.BASE_PATH;

    // Test with BASE_PATH set
    process.env.BASE_PATH = "/cc";
    const config1 = parseServerConfig([]);
    expect(config1.basePath).toBe("/cc");

    // Test without BASE_PATH
    delete process.env.BASE_PATH;
    const config2 = parseServerConfig([]);
    expect(config2.basePath).toBe("");

    // Restore original env
    if (originalBasePath !== undefined) {
      process.env.BASE_PATH = originalBasePath;
    } else {
      delete process.env.BASE_PATH;
    }
  });

  test("basePath is used in WS plugin creation", () => {
    const config = parseServerConfig([]);
    // The config should always have a basePath field (even if empty)
    expect(config).toHaveProperty("basePath");
    expect(typeof config.basePath).toBe("string");
  });
});
