import { describe, expect, test } from "bun:test";
import {
  describeHangarCap,
  readPerfCoresViaSysctl,
  resolveHangarCapWithSource,
} from "../hangar-cap";

describe("readPerfCoresViaSysctl", () => {
  test("reads the count via the absolute sysctl path", () => {
    const calls: string[][] = [];
    const n = readPerfCoresViaSysctl((argv) => {
      calls.push(argv);
      return { exitCode: 0, stdout: "6\n" };
    });
    expect(n).toBe(6);
    expect(calls).toEqual([["/usr/sbin/sysctl", "-n", "hw.perflevel0.physicalcpu"]]);
  });

  test("non-zero exit -> null", () => {
    expect(readPerfCoresViaSysctl(() => ({ exitCode: 1, stdout: "" }))).toBeNull();
  });

  test("non-numeric output -> null", () => {
    expect(readPerfCoresViaSysctl(() => ({ exitCode: 0, stdout: "abc\n" }))).toBeNull();
  });

  test("zero -> null", () => {
    expect(readPerfCoresViaSysctl(() => ({ exitCode: 0, stdout: "0\n" }))).toBeNull();
  });

  test("a throwing runner -> null", () => {
    expect(
      readPerfCoresViaSysctl(() => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });
});

describe("resolveHangarCapWithSource", () => {
  test("source: blank override counts as unset and names the core count", () => {
    expect(resolveHangarCapWithSource("   ", () => 6)).toEqual({
      cap: 4,
      source: "perf-cores",
      cores: 6,
    });
  });

  test("source: a pinned value names the override and skips the reader", () => {
    let calls = 0;
    const r = resolveHangarCapWithSource("3", () => {
      calls++;
      return 6;
    });
    expect(r).toEqual({ cap: 3, source: "override" });
    expect(calls).toBe(0);
  });

  test("source: an unreadable count names the fallback", () => {
    expect(resolveHangarCapWithSource(undefined, () => null)).toEqual({
      cap: 4,
      source: "unreadable",
    });
  });

  test("source: the startup line reads each source", () => {
    expect(describeHangarCap({ cap: 4, source: "perf-cores", cores: 6 })).toBe(
      "hangar cap 4 (6 performance cores)",
    );
    expect(describeHangarCap({ cap: 2, source: "override" })).toBe(
      "hangar cap 2 (CC_MOBILE_HANGAR_CAP)",
    );
    expect(describeHangarCap({ cap: 4, source: "unreadable" })).toBe(
      "hangar cap 4 (performance cores unreadable)",
    );
  });
});
