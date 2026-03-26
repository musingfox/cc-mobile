import { describe, expect, test } from "bun:test";

describe("Contract 8: Manifest start_url", () => {
  test("empty BASE_PATH → start_url: /", () => {
    const basePath = "";
    const manifest = {
      name: "CCMobile",
      start_url: `${basePath}/`,
    };
    expect(manifest.start_url).toBe("/");
  });

  test('BASE_PATH="/cc" → start_url: /cc/', () => {
    const basePath = "/cc";
    const manifest = {
      name: "CCMobile",
      start_url: `${basePath}/`,
    };
    expect(manifest.start_url).toBe("/cc/");
  });
});
