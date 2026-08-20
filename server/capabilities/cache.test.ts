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

describe("CapabilityProbeFailureRetried", () => {
  test("retries after a failed result", async () => {
    const cache = createCapabilityCache<Result>();
    let calls = 0;
    const load = async (): Promise<Result> => {
      calls++;
      return calls === 1 ? { ok: false } : success;
    };

    expect(await cache.get("claude", "/a", load)).toEqual({ ok: false });
    expect(await cache.get("claude", "/a", load)).toEqual(success);
    expect(calls).toBe(2);
  });

  test("caches a successful empty list", async () => {
    const cache = createCapabilityCache<Result>();
    let calls = 0;
    const empty: Result = { ok: true, commands: [], agents: [] };
    const load = async (): Promise<Result> => {
      calls++;
      return calls === 1 ? empty : success;
    };

    expect(await cache.get("claude", "/a", load)).toEqual(empty);
    expect(await cache.get("claude", "/a", load)).toEqual(empty);
    expect(calls).toBe(1);
  });

  test("retries after a rejected load", async () => {
    const cache = createCapabilityCache<Result>();
    let calls = 0;
    const load = async (): Promise<Result> => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return { ok: true, commands: [], agents: [] };
    };

    await expect(cache.get("claude", "/a", load)).rejects.toThrow("boom");
    expect(await cache.get("claude", "/a", load)).toEqual({
      ok: true,
      commands: [],
      agents: [],
    });
    expect(calls).toBe(2);
  });
});

describe("CapabilityRefreshBypassesCache", () => {
  test("refresh replaces the cached success", async () => {
    const cache = createCapabilityCache<Result>();
    let calls = 0;
    const refreshed: Result = {
      ok: true,
      commands: [{ name: "h" }, { name: "n" }],
      agents: [],
    };
    const load = async (): Promise<Result> => {
      calls++;
      return calls === 1 ? success : refreshed;
    };

    await cache.get("claude", "/a", load);
    const second = await cache.get("claude", "/a", load, { refresh: true });
    const third = await cache.get("claude", "/a", load);

    expect(calls).toBe(2);
    expect(second.ok && second.commands).toHaveLength(2);
    expect(third.ok && third.commands).toHaveLength(2);
  });

  test("a failed refresh preserves the cached success", async () => {
    const cache = createCapabilityCache<Result>();
    let calls = 0;
    const load = async (): Promise<Result> => {
      calls++;
      return success;
    };

    await cache.get("claude", "/a", load);
    expect(
      await cache.get("claude", "/a", async () => ({ ok: false }), {
        refresh: true,
      }),
    ).toEqual({ ok: false });
    expect(await cache.get("claude", "/a", load)).toEqual(success);
    expect(calls).toBe(1);
  });
});
