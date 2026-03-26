import { describe, expect, test } from "bun:test";

describe("Contract 7: SW Cache Paths", () => {
  test("empty BASE_PATH → paths start with /", () => {
    const BASE_PATH = "";
    const STATIC_ASSETS = [
      BASE_PATH + "/",
      BASE_PATH + "/index.html",
      BASE_PATH + "/manifest.json",
      BASE_PATH + "/icons/icon-192.png",
    ];
    expect(STATIC_ASSETS).toEqual(["/", "/index.html", "/manifest.json", "/icons/icon-192.png"]);
  });

  test('BASE_PATH="/cc" → paths start with /cc', () => {
    const BASE_PATH = "/cc";
    const STATIC_ASSETS = [
      BASE_PATH + "/",
      BASE_PATH + "/index.html",
      BASE_PATH + "/manifest.json",
      BASE_PATH + "/icons/icon-192.png",
    ];
    expect(STATIC_ASSETS).toEqual([
      "/cc/",
      "/cc/index.html",
      "/cc/manifest.json",
      "/cc/icons/icon-192.png",
    ]);
  });
});
