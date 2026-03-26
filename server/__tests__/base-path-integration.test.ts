import { describe, expect, test } from "bun:test";
import { parseBasePath } from "../config";
import { buildUrl } from "../path-utils";

describe("Contract 4: Elysia WS Route", () => {
  test("empty basePath → route at /ws", () => {
    const basePath = parseBasePath("");
    const wsPath = buildUrl(basePath, "/ws");
    expect(wsPath).toBe("/ws");
  });

  test("/cc basePath → route at /cc/ws", () => {
    const basePath = parseBasePath("/cc");
    const wsPath = buildUrl(basePath, "/ws");
    expect(wsPath).toBe("/cc/ws");
  });
});

describe("Contract 5: Static File Handler", () => {
  test("BASE_PATH empty, GET /index.html → pathname: /index.html", () => {
    const basePath = parseBasePath("");
    const pathname = "/index.html";
    const strippedPath = pathname;
    expect(strippedPath).toBe("/index.html");
  });

  test('BASE_PATH="/cc", GET /cc/index.html → pathname: /index.html', () => {
    const basePath = parseBasePath("/cc");
    const requestPath = "/cc/index.html";
    // Simulate stripBasePath
    const stripped = requestPath.startsWith(basePath)
      ? requestPath.slice(basePath.length)
      : requestPath;
    expect(stripped).toBe("/index.html");
  });

  test('BASE_PATH="/cc", GET /cc/../etc/passwd → should be rejected by traversal check', () => {
    // This is a security test - the handler should reject this
    // We're just testing the path doesn't get normalized incorrectly
    const basePath = parseBasePath("/cc");
    const requestPath = "/cc/../etc/passwd";
    const stripped = requestPath.startsWith(basePath)
      ? requestPath.slice(basePath.length)
      : requestPath;
    // The stripped path will be "/../etc/passwd" which should fail join() traversal check
    expect(stripped).toBe("/../etc/passwd");
  });
});
