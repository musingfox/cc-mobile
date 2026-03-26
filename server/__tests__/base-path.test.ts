import { describe, expect, test } from "bun:test";
import { parseBasePath } from "../config";

describe("parseBasePath (Contract 1)", () => {
  test("undefined → empty string", () => {
    expect(parseBasePath(undefined)).toBe("");
  });

  test("empty string → empty string", () => {
    expect(parseBasePath("")).toBe("");
  });

  test("/cc → /cc", () => {
    expect(parseBasePath("/cc")).toBe("/cc");
  });

  test("cc → throws", () => {
    expect(() => parseBasePath("cc")).toThrow("BASE_PATH must start with /");
  });

  test("/cc/ → throws", () => {
    expect(() => parseBasePath("/cc/")).toThrow("BASE_PATH cannot end with /");
  });

  test("/cc/../admin → throws", () => {
    expect(() => parseBasePath("/cc/../admin")).toThrow("BASE_PATH cannot contain ..");
  });

  test("/cc-mobile → /cc-mobile", () => {
    expect(parseBasePath("/cc-mobile")).toBe("/cc-mobile");
  });
});
