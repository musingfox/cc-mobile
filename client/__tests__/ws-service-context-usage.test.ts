import { describe, expect, test } from "bun:test";
import { deriveContextUsage, MAX_TOKENS_FALLBACK } from "../services/ws-service";

describe("deriveContextUsage", () => {
  test("sums input + output + cache tokens against provided maxTokens", () => {
    const result = deriveContextUsage(
      {
        input_tokens: 5000,
        output_tokens: 3000,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 100,
      },
      200_000,
    );

    expect(result).not.toBeNull();
    expect(result?.totalTokens).toBe(8200);
    expect(result?.maxTokens).toBe(200_000);
    // 8200 / 200000 = 0.041
    expect(result?.percentage).toBeCloseTo(0.041, 5);
  });

  test("returns null when usage is undefined", () => {
    expect(deriveContextUsage(undefined, 200_000)).toBeNull();
  });

  test("treats missing fields as zero", () => {
    const result = deriveContextUsage({ input_tokens: 1000 }, 200_000);
    expect(result?.totalTokens).toBe(1000);
  });

  test("falls back to MAX_TOKENS_FALLBACK when maxTokens is null", () => {
    const result = deriveContextUsage({ input_tokens: 1000 }, null);
    expect(result?.maxTokens).toBe(MAX_TOKENS_FALLBACK);
    expect(MAX_TOKENS_FALLBACK).toBe(200_000);
  });

  test("falls back to MAX_TOKENS_FALLBACK when maxTokens is undefined", () => {
    const result = deriveContextUsage({ input_tokens: 1000 }, undefined);
    expect(result?.maxTokens).toBe(MAX_TOKENS_FALLBACK);
  });

  test("falls back when maxTokens is zero or negative", () => {
    const result = deriveContextUsage({ input_tokens: 500 }, 0);
    expect(result?.maxTokens).toBe(MAX_TOKENS_FALLBACK);
  });

  test("percentage reflects warning threshold", () => {
    const result = deriveContextUsage({ input_tokens: 170_000 }, 200_000);
    expect(result?.percentage).toBeGreaterThanOrEqual(0.8);
  });
});
