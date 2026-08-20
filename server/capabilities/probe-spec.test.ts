import { describe, expect, test } from "bun:test";
import { buildProbeSpec } from "./probe-spec";

const inheritedEnv = {
  HERDR_ENV: "1",
  HERDR_PANE_ID: "w89:p1",
  HERDR_SOCKET_PATH: "/run/herdr.sock",
  HERDR_TAB_ID: "w89:t1",
  PATH: "/usr/bin",
};

describe("Probe invocation spec", () => {
  test("T1: strips inherited herdr pane identity", () => {
    const output = buildProbeSpec({ cwd: "/tmp/x", env: inheritedEnv });

    expect("HERDR_ENV" in output.env).toBe(false);
    expect("HERDR_PANE_ID" in output.env).toBe(false);
    expect("HERDR_SOCKET_PATH" in output.env).toBe(false);
    expect(output.env.PATH).toBe("/usr/bin");
  });

  test("T2: uses the non-persistent stream-json command line", () => {
    const output = buildProbeSpec({ cwd: "/tmp/x", env: inheritedEnv });

    expect(output.argv).toEqual([
      "claude",
      "-p",
      "/help",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
    ]);
  });

  test("T3: pins session persistence off", () => {
    const output = buildProbeSpec({ cwd: "/tmp/x", env: inheritedEnv });

    expect(output.argv).toContain("--no-session-persistence");
  });

  test("T4: accepts an environment without herdr variables", () => {
    expect(() =>
      buildProbeSpec({ cwd: "/tmp/x", env: { PATH: "/usr/bin" } }),
    ).not.toThrow();
    expect(buildProbeSpec({ cwd: "/tmp/x", env: { PATH: "/usr/bin" } }).env).toEqual({
      PATH: "/usr/bin",
    });
  });

  test("T5: preserves the requested working directory", () => {
    const output = buildProbeSpec({ cwd: "/Users/n/repo", env: {} });

    expect(output.cwd).toBe("/Users/n/repo");
  });

  test("T6: preserves unrelated herdr metadata", () => {
    const output = buildProbeSpec({
      cwd: "/tmp/x",
      env: { HERDR_TAB_ID: "w89:t1", HERDR_WORKSPACE_ID: "w89" },
    });

    expect(output.env.HERDR_TAB_ID).toBe("w89:t1");
    expect(output.env.HERDR_WORKSPACE_ID).toBe("w89");
  });
});
