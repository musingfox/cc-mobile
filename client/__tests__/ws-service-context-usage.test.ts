import { describe, expect, test } from "bun:test";
import {
  deriveContextUsage,
  MAX_TOKENS_FALLBACK,
  ONE_MILLION_CONTEXT,
  resolveContextWindow,
} from "../services/ws-service";

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

describe("resolveContextWindow", () => {
  test("returns 1M for a [1m] model regardless of catalogued contextLength", () => {
    expect(resolveContextWindow("claude-opus-4-8[1m]", 200_000)).toBe(ONE_MILLION_CONTEXT);
    expect(resolveContextWindow("claude-opus-4-8[1m]", undefined)).toBe(ONE_MILLION_CONTEXT);
    expect(ONE_MILLION_CONTEXT).toBe(1_000_000);
  });

  test("returns the catalogued contextLength for non-1m models", () => {
    expect(resolveContextWindow("claude-sonnet-4-6", 200_000)).toBe(200_000);
  });

  test("returns undefined when neither signal is present (caller falls back)", () => {
    expect(resolveContextWindow("claude-sonnet-4-6", undefined)).toBeUndefined();
    expect(resolveContextWindow(undefined, undefined)).toBeUndefined();
  });

  test("feeds deriveContextUsage so a 1M model shows /1M not /200k", () => {
    const max = resolveContextWindow("claude-opus-4-8[1m]", 200_000);
    const usage = deriveContextUsage({ input_tokens: 55_000 }, max);
    expect(usage?.maxTokens).toBe(1_000_000);
  });
});
