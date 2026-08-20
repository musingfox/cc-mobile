import { describe, expect, test } from "bun:test";
import { createCapabilityCache } from "./cache";

type Result =
  | { ok: true; commands: { name: string }[]; agents: { name: string }[] }
  | { ok: false };

const success: Result = { ok: true, commands: [{ name: "h" }], agents: [] };

describe("CapabilityCacheHitByKindAndCwd", () => {
  test("caches a successful result for the same kind and cwd", async () => {
    const cache = createCapabilityCache<Result>();
    let calls = 0;
    const load = async () => {
      calls++;
      return success;
    };

    const first = await cache.get("claude", "/a", load);
    const second = await cache.get("claude", "/a", load);

    expect(calls).toBe(1);
    expect(first).toEqual(success);
    expect(second).toEqual(success);
  });

  test("uses cwd as part of the cache key", async () => {
    const cache = createCapabilityCache<Result>();
    let calls = 0;
    const load = async () => {
      calls++;
      return success;
    };

    await cache.get("claude", "/a", load);
    await cache.get("claude", "/b", load);

    expect(calls).toBe(2);
  });

  test("uses agent kind as part of the cache key", async () => {
    const cache = createCapabilityCache<Result>();
    let calls = 0;
    const load = async () => {
      calls++;
      return success;
    };

    await cache.get("claude", "/a", load);
    await cache.get("omp", "/a", load);

    expect(calls).toBe(2);
  });

  test("deduplicates concurrent misses", async () => {
    const cache = createCapabilityCache<Result>();
    let calls = 0;
    let resolveLoad!: (result: Result) => void;
    const load = () => {
      calls++;
      return new Promise<Result>((resolve) => {
        resolveLoad = resolve;
      });
    };

    const first = cache.get("claude", "/a", load);
    const second = cache.get("claude", "/a", load);

    expect(calls).toBe(1);
    resolveLoad(success);
    expect(await first).toEqual(success);
    expect(await second).toEqual(success);
  });
});
