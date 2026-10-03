/**
 * CapabilityFetcherRegistry — a kind with no registered fetcher is answered
 * by lookup miss, with no spawn and no disk access.
 */

import { describe, expect, test } from "bun:test";
import type { ProbeResult } from "../capabilities/claude-probe";
import type { EnrichedCapability, PluginInfo } from "../capabilities/enrich";
import { capabilityFetcherFor, createOmpFetcher } from "./capability-fetchers";

describe("CapabilityFetcherRegistry", () => {
  test("T1: claude has a registered fetcher", () => {
    expect(capabilityFetcherFor("claude")).not.toBeUndefined();
  });

  test("T2: omp has a registered fetcher", () => {
    expect(capabilityFetcherFor("omp")).not.toBeUndefined();
  });

  test("T3: an undetected kind is never assumed to be claude", () => {
    expect(capabilityFetcherFor(undefined)).toBeUndefined();
  });

  test("T4: gemini has no fetcher", () => {
    expect(capabilityFetcherFor("gemini")).toBeUndefined();
  });

  test("T5: empty kind has no fetcher", () => {
    expect(capabilityFetcherFor("")).toBeUndefined();
  });

  test("T6: claude entry probes then enriches names", async () => {
    const fetcher = capabilityFetcherFor("claude");
    expect(fetcher).not.toBeUndefined();

    const probe = async (): Promise<ProbeResult> => ({
      ok: true,
      commands: ["help"],
      agents: ["Explore"],
      plugins: [],
    });
    const enrich = (names: string[], _options?: { plugins?: PluginInfo[] }): EnrichedCapability[] =>
      names.map((name) => ({ name }));

    await expect(fetcher!.list({ cwd: "/repo", probe, enrich })).resolves.toEqual({
      ok: true,
      commands: [{ name: "help" }],
      agents: [{ name: "Explore" }],
    });
  });

  test("T7: a failed probe never calls enrich", async () => {
    const fetcher = capabilityFetcherFor("claude");
    expect(fetcher).not.toBeUndefined();

    const probe = async (): Promise<ProbeResult> => ({ ok: false, reason: "timeout" });
    let enrichCalls = 0;
    const enrich = (names: string[]): EnrichedCapability[] => {
      enrichCalls += 1;
      return names.map((name) => ({ name }));
    };

    await expect(fetcher!.list({ cwd: "/repo", probe, enrich })).resolves.toEqual({ ok: false });
    expect(enrichCalls).toBe(0);
  });
});

describe("OmpCapabilityFetcher", () => {
  test("omp's own commands come back as they are, with no agents", async () => {
    const fetcher = createOmpFetcher(async () => ({
      ok: true,
      commands: [{ name: "model", description: "Switch model", argumentHint: "<name>" }],
    }));

    await expect(fetcher.list({ cwd: "/repo" })).resolves.toEqual({
      ok: true,
      commands: [{ name: "model", description: "Switch model", argumentHint: "<name>" }],
      agents: [],
    });
  });

  test("a failed omp probe is unavailable, not a broken picker", async () => {
    const fetcher = createOmpFetcher(async () => ({ ok: false, reason: "timeout" }));

    await expect(fetcher.list({ cwd: "/repo" })).resolves.toEqual({ ok: false });
  });
});
