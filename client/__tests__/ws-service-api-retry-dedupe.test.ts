import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toastService } from "../services/toast-service";
import { handleApiRetryChunk } from "../services/ws-service";

describe("handleApiRetryChunk", () => {
  let infoSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    infoSpy = spyOn(toastService, "info").mockImplementation(() => "" as never);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  test("two consecutive chunks with same (error_status, attempt): toast fires exactly once", () => {
    const seen = new Set<string>();
    const chunk = {
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 3,
      retry_delay_ms: 4000,
      error_status: 429,
    };

    expect(handleApiRetryChunk(chunk, seen)).toBe(true);
    expect(handleApiRetryChunk(chunk, seen)).toBe(true);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith("API retrying (2/3) in 4s...");
  });

  test("three attempts (1, 2, 3) with same error_status: three separate toasts (progression preserved)", () => {
    const seen = new Set<string>();
    const baseline = {
      type: "system" as const,
      subtype: "api_retry" as const,
      max_retries: 3,
      retry_delay_ms: 4000,
      error_status: 429,
    };

    handleApiRetryChunk({ ...baseline, attempt: 1 }, seen);
    handleApiRetryChunk({ ...baseline, attempt: 2 }, seen);
    handleApiRetryChunk({ ...baseline, attempt: 3 }, seen);

    expect(infoSpy).toHaveBeenCalledTimes(3);
    expect(infoSpy.mock.calls.map((c) => c[0])).toEqual([
      "API retrying (1/3) in 4s...",
      "API retrying (2/3) in 4s...",
      "API retrying (3/3) in 4s...",
    ]);
  });

  test("error_status=null collapses under dedupe key 'unknown-{attempt}'", () => {
    const seen = new Set<string>();
    const chunk = {
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 3,
      retry_delay_ms: 4000,
      error_status: null,
    };

    handleApiRetryChunk(chunk, seen);
    handleApiRetryChunk(chunk, seen);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(seen.has("unknown-2")).toBe(true);
  });

  test("retry_delay_ms === 0 renders without seconds suffix", () => {
    const seen = new Set<string>();
    handleApiRetryChunk(
      {
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 0,
        error_status: 500,
      },
      seen,
    );

    expect(infoSpy).toHaveBeenCalledWith("API retrying (1/3)...");
  });

  test("non api_retry chunk: returns false, no toast", () => {
    const seen = new Set<string>();
    const result = handleApiRetryChunk(
      { type: "system", subtype: "something_else" } as Record<string, unknown>,
      seen,
    );

    expect(result).toBe(false);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test("clearing the seen set re-arms dedupe (mirrors stream_end semantics)", () => {
    const seen = new Set<string>();
    const chunk = {
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 3,
      retry_delay_ms: 4000,
      error_status: 429,
    };

    handleApiRetryChunk(chunk, seen);
    handleApiRetryChunk(chunk, seen);
    expect(infoSpy).toHaveBeenCalledTimes(1);

    seen.clear();
    handleApiRetryChunk(chunk, seen);
    expect(infoSpy).toHaveBeenCalledTimes(2);
  });
});
