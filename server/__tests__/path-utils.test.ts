import { describe, expect, test } from "bun:test";
import { buildUrl, stripBasePath } from "../path-utils";

describe("buildUrl (Contract 2)", () => {
  test('empty basePath + "/ws" → "/ws"', () => {
    expect(buildUrl("", "/ws")).toBe("/ws");
  });

  test('"/cc" + "/ws" → "/cc/ws"', () => {
    expect(buildUrl("/cc", "/ws")).toBe("/cc/ws");
  });

  test('"/cc" + "/api/status" → "/cc/api/status"', () => {
    expect(buildUrl("/cc", "/api/status")).toBe("/cc/api/status");
  });

  test('"/cc" + "/" → "/cc/"', () => {
    expect(buildUrl("/cc", "/")).toBe("/cc/");
  });
});

describe("stripBasePath (Contract 3)", () => {
  test('"/cc/index.html" with "/cc" → "/index.html"', () => {
    expect(stripBasePath("/cc/index.html", "/cc")).toBe("/index.html");
  });

  test('"/index.html" with empty basePath → "/index.html"', () => {
    expect(stripBasePath("/index.html", "")).toBe("/index.html");
  });

  test('"/other/path" with "/cc" → "/other/path"', () => {
    expect(stripBasePath("/other/path", "/cc")).toBe("/other/path");
  });

  test('"/cc" with "/cc" → "/"', () => {
    expect(stripBasePath("/cc", "/cc")).toBe("/");
  });

  test('"/cc-mobile" with "/cc" → "/cc-mobile" (boundary check)', () => {
    expect(stripBasePath("/cc-mobile", "/cc")).toBe("/cc-mobile");
  });
});
