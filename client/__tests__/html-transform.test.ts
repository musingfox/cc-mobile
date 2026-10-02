import { describe, expect, test } from "bun:test";
import { substituteBasePath } from "../../pwa-stamp";

describe("Contract 9: index.html Template", () => {
  test('empty basePath, href="__BASE_PATH__/manifest.json" → href="/manifest.json"', () => {
    const html = '<link rel="manifest" href="__BASE_PATH__/manifest.json" />';
    expect(substituteBasePath(html, "")).toBe('<link rel="manifest" href="/manifest.json" />');
  });

  test('"/cc" basePath, href="__BASE_PATH__/manifest.json" → href="/cc/manifest.json"', () => {
    const html = '<link rel="manifest" href="__BASE_PATH__/manifest.json" />';
    expect(substituteBasePath(html, "/cc")).toBe(
      '<link rel="manifest" href="/cc/manifest.json" />',
    );
  });

  test('empty basePath, window.__BASE_PATH__ = "__BASE_PATH__" → window.__BASE_PATH__ = ""', () => {
    const html = '<script>window.__BASE_PATH__ = "__BASE_PATH__";</script>';
    expect(substituteBasePath(html, "")).toBe('<script>window.__BASE_PATH__ = "";</script>');
  });

  test('"/cc" basePath, window.__BASE_PATH__ = "__BASE_PATH__" → window.__BASE_PATH__ = "/cc"', () => {
    const html = '<script>window.__BASE_PATH__ = "__BASE_PATH__";</script>';
    expect(substituteBasePath(html, "/cc")).toBe('<script>window.__BASE_PATH__ = "/cc";</script>');
  });
});
