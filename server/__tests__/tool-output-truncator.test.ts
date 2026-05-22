import { describe, expect, test } from "bun:test";
import { TRUNCATE_THRESHOLD_CHARS, truncateToolResponse } from "../tool-output-truncator";

const big = (size: number, char = "x") => char.repeat(size);

describe("truncateToolResponse", () => {
  test("returns null for small string under threshold", () => {
    expect(truncateToolResponse("hello")).toBeNull();
    expect(truncateToolResponse(big(TRUNCATE_THRESHOLD_CHARS))).toBeNull();
  });

  test("truncates oversized raw string keeping head + tail", () => {
    const input = `HEAD${big(TRUNCATE_THRESHOLD_CHARS * 2)}TAIL`;
    const out = truncateToolResponse(input);
    expect(typeof out).toBe("string");
    const text = out as string;
    expect(text.length).toBeLessThan(input.length);
    expect(text.startsWith("HEAD")).toBe(true);
    expect(text.endsWith("TAIL")).toBe(true);
    expect(text).toContain("cc-mobile truncated");
  });

  test("truncates MCP-style content blocks", () => {
    const input = {
      content: [
        { type: "text", text: "short" },
        { type: "text", text: big(TRUNCATE_THRESHOLD_CHARS + 100) },
      ],
    };
    const out = truncateToolResponse(input) as typeof input;
    expect(out).not.toBeNull();
    expect(out.content[0]).toEqual({ type: "text", text: "short" });
    expect((out.content[1] as { text: string }).text).toContain("cc-mobile truncated");
  });

  test("truncates stdout / output / stderr string fields", () => {
    const input = {
      stdout: big(TRUNCATE_THRESHOLD_CHARS + 50),
      stderr: "small",
      output: big(TRUNCATE_THRESHOLD_CHARS + 50),
      exit_code: 0,
    };
    const out = truncateToolResponse(input) as typeof input;
    expect(out).not.toBeNull();
    expect(out.stdout).toContain("cc-mobile truncated");
    expect(out.stderr).toBe("small");
    expect(out.output).toContain("cc-mobile truncated");
    expect(out.exit_code).toBe(0);
  });

  test("returns null when nothing oversized", () => {
    expect(truncateToolResponse({ stdout: "ok", exit_code: 0 })).toBeNull();
    expect(truncateToolResponse({ content: [{ type: "text", text: "ok" }] })).toBeNull();
  });

  test("ignores unknown shapes safely", () => {
    expect(truncateToolResponse(null)).toBeNull();
    expect(truncateToolResponse(42)).toBeNull();
    expect(truncateToolResponse(undefined)).toBeNull();
    expect(truncateToolResponse({ foo: big(TRUNCATE_THRESHOLD_CHARS + 50) })).toBeNull();
  });
});
