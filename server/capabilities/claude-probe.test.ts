import { describe, expect, test } from "bun:test";
import { probeClaudeCapabilities, type ProbeSpawn } from "./claude-probe";

function stdoutSpawn(stdout: string): ProbeSpawn & { calls: unknown[] } {
  const calls: unknown[] = [];
  const spawn: ProbeSpawn & { calls: unknown[] } = (spec) => {
    calls.push(spec);
    return { stdout: Promise.resolve(stdout), kill() {} };
  };
  spawn.calls = calls;
  return spawn;
}

describe("Claude capability probe", () => {
  test("T1: extracts commands, agents, and plugins from an init line", async () => {
    const spawn = stdoutSpawn(
      '{"type":"system","subtype":"init","slash_commands":["help","obw:pm"],"agents":["Explore"],"plugins":[{"name":"obw","path":"/p/obw"}]}\n',
    );

    await expect(probeClaudeCapabilities({ cwd: "/repo", spawn })).resolves.toEqual({
      ok: true,
      commands: ["help", "obw:pm"],
      agents: ["Explore"],
      plugins: [{ name: "obw", path: "/p/obw" }],
    });
  });

  test("T2: skips non-JSON and non-init lines instead of failing the batch", async () => {
    const spawn = stdoutSpawn(
      'not json\n{"type":"x"}\n{"subtype":"init","slash_commands":["a"],"agents":[],"plugins":[]}\n',
    );

    await expect(probeClaudeCapabilities({ cwd: "/repo", spawn })).resolves.toEqual({
      ok: true,
      commands: ["a"],
      agents: [],
      plugins: [],
    });
  });

  test("T3: a completed stream without init is no_init", async () => {
    const spawn = stdoutSpawn('{"type":"result","subtype":"success"}\n');

    await expect(probeClaudeCapabilities({ cwd: "/repo", spawn })).resolves.toEqual({
      ok: false,
      reason: "no_init",
    });
  });

  test("T4: empty stdout is no_init", async () => {
    const spawn = stdoutSpawn("");

    await expect(probeClaudeCapabilities({ cwd: "/repo", spawn })).resolves.toEqual({
      ok: false,
      reason: "no_init",
    });
  });

  test("T5: a missing agents key becomes an empty list", async () => {
    const spawn = stdoutSpawn(
      '{"type":"system","subtype":"init","slash_commands":["help"],"plugins":[{"name":"obw","path":"/p/obw"}]}\n',
    );

    await expect(probeClaudeCapabilities({ cwd: "/repo", spawn })).resolves.toEqual({
      ok: true,
      commands: ["help"],
      agents: [],
      plugins: [{ name: "obw", path: "/p/obw" }],
    });
  });

  test("T6: a hanging stdout times out and kills the child once", async () => {
    let killCount = 0;
    const spawn: ProbeSpawn & { killCount: number } = Object.assign(
      () => ({
        stdout: new Promise<string>(() => {}),
        kill() {
          killCount += 1;
        },
      }),
      { killCount: 0 },
    );

    const result = await probeClaudeCapabilities({ cwd: "/repo", spawn, timeoutMs: 10 });
    spawn.killCount = killCount;

    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(spawn.killCount).toBe(1);
  });

  test("T7: a throwing spawn resolves spawn_error instead of rejecting", async () => {
    const spawn: ProbeSpawn = () => {
      throw new Error("ENOENT");
    };

    await expect(probeClaudeCapabilities({ cwd: "/repo", spawn })).resolves.toEqual({
      ok: false,
      reason: "spawn_error",
    });
  });

  test("T8: spawn is invoked once with the probe-spec cwd and scrubbed env", async () => {
    const spawn = stdoutSpawn(
      '{"subtype":"init","slash_commands":[],"agents":[],"plugins":[]}\n',
    );

    await probeClaudeCapabilities({ cwd: "/repo", spawn });

    expect(spawn.calls).toHaveLength(1);
    const arg = spawn.calls[0] as { cwd: string; env: Record<string, string | undefined> };
    expect(arg.cwd).toBe("/repo");
    expect("HERDR_ENV" in arg.env).toBe(false);
  });
});
