import { describe, expect, test } from "bun:test";
import { parseBasePath, parseServerConfig } from "../config";
import { buildUrl, stripBasePath } from "../path-utils";

describe("BASE_PATH E2E Integration", () => {
  test("full flow with BASE_PATH=/cc", () => {
    // Contract 1: Parse base path from env
    const basePath = parseBasePath("/cc");
    expect(basePath).toBe("/cc");

    // Contract 2: Build WS route
    const wsPath = buildUrl(basePath, "/ws");
    expect(wsPath).toBe("/cc/ws");

    // Contract 3: Strip base path from incoming request
    const incomingPath = "/cc/index.html";
    const strippedPath = stripBasePath(incomingPath, basePath);
    expect(strippedPath).toBe("/index.html");

    // Verify it works in ServerConfig
    process.env.BASE_PATH = "/cc";
    const config = parseServerConfig([]);
    expect(config.basePath).toBe("/cc");
    delete process.env.BASE_PATH;
  });

  test("full flow with empty BASE_PATH", () => {
    // Contract 1: Parse empty base path
    const basePath = parseBasePath("");
    expect(basePath).toBe("");

    // Contract 2: Build WS route
    const wsPath = buildUrl(basePath, "/ws");
    expect(wsPath).toBe("/ws");

    // Contract 3: Strip base path (no-op)
    const incomingPath = "/index.html";
    const strippedPath = stripBasePath(incomingPath, basePath);
    expect(strippedPath).toBe("/index.html");

    // Verify it works in ServerConfig
    delete process.env.BASE_PATH;
    const config = parseServerConfig([]);
    expect(config.basePath).toBe("");
  });

  test("security: path traversal blocked", () => {
    // This should be caught by parseBasePath
    expect(() => parseBasePath("/cc/../admin")).toThrow("BASE_PATH cannot contain ..");
  });

  test("security: must start with slash", () => {
    expect(() => parseBasePath("cc")).toThrow("BASE_PATH must start with /");
  });

  test("security: cannot end with slash", () => {
    expect(() => parseBasePath("/cc/")).toThrow("BASE_PATH cannot end with /");
  });
});
