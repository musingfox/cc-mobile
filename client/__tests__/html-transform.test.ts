import { describe, expect, test } from "bun:test";

describe("Contract 9: index.html Template", () => {
  test('empty basePath, href="__BASE_PATH__/manifest.json" → href="/manifest.json"', () => {
    const basePath = "";
    const html = '<link rel="manifest" href="__BASE_PATH__/manifest.json" />';
    const replaced = html.replace(/__BASE_PATH__\//g, `${basePath}/`);
    expect(replaced).toBe('<link rel="manifest" href="/manifest.json" />');
  });

  test('"/cc" basePath, href="__BASE_PATH__/manifest.json" → href="/cc/manifest.json"', () => {
    const basePath = "/cc";
    const html = '<link rel="manifest" href="__BASE_PATH__/manifest.json" />';
    const replaced = html.replace(/__BASE_PATH__\//g, `${basePath}/`);
    expect(replaced).toBe('<link rel="manifest" href="/cc/manifest.json" />');
  });

  test('empty basePath, window.__BASE_PATH__ = "__BASE_PATH__" → window.__BASE_PATH__ = ""', () => {
    const basePath = "";
    const html = '<script>window.__BASE_PATH__ = "__BASE_PATH__";</script>';
    const replaced = html.replace(
      /window\.__BASE_PATH__ = "__BASE_PATH__"/g,
      `window.__BASE_PATH__ = "${basePath}"`,
    );
    expect(replaced).toBe('<script>window.__BASE_PATH__ = "";</script>');
  });

  test('"/cc" basePath, window.__BASE_PATH__ = "__BASE_PATH__" → window.__BASE_PATH__ = "/cc"', () => {
    const basePath = "/cc";
    const html = '<script>window.__BASE_PATH__ = "__BASE_PATH__";</script>';
    const replaced = html.replace(
      /window\.__BASE_PATH__ = "__BASE_PATH__"/g,
      `window.__BASE_PATH__ = "${basePath}"`,
    );
    expect(replaced).toBe('<script>window.__BASE_PATH__ = "/cc";</script>');
  });
});
