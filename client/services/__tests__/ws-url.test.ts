import { describe, expect, test } from "bun:test";

describe("Contract 6: Client WS URL", () => {
  test("empty basePath + localhost:5173 → ws://localhost:5173/ws", () => {
    const basePath = "";
    const protocol = "ws:";
    const host = "localhost:5173";
    const wsUrl = `${protocol}//${host}${basePath}/ws`;
    expect(wsUrl).toBe("ws://localhost:5173/ws");
  });

  test('"/cc" + example.com (HTTPS) → wss://example.com/cc/ws', () => {
    const basePath = "/cc";
    const protocol = "wss:";
    const host = "example.com";
    const wsUrl = `${protocol}//${host}${basePath}/ws`;
    expect(wsUrl).toBe("wss://example.com/cc/ws");
  });
});
