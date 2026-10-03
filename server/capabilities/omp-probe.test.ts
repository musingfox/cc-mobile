import { describe, expect, test } from "bun:test";
import {
  OMP_PROBE_ARGV,
  type OmpProbeProcess,
  parseOmpCommandsResponse,
  probeOmpCapabilities,
} from "./omp-probe";

function fakeProcess(lines: string[], options: { hang?: boolean } = {}) {
  const sent: string[] = [];
  let killed = 0;
  const process: OmpProbeProcess = {
    lines: (async function* () {
      for (const line of lines) yield line;
      if (options.hang) await new Promise(() => {});
    })(),
    send: (line) => sent.push(line),
    kill: () => {
      killed += 1;
    },
  };
  return { process, sent, killed: () => killed };
}

const answer = JSON.stringify({
  id: "cc-mobile-capabilities",
  type: "response",
  command: "get_available_commands",
  success: true,
  data: {
    commands: [
      { name: "model", description: "Switch model", input: { hint: "<name>" }, source: "builtin" },
      { name: "plain", source: "skill" },
      { description: "nameless" },
    ],
  },
});

describe("OmpCommandsResponse", () => {
  test("keeps name, description and hint, and drops an entry with no name", () => {
    expect(parseOmpCommandsResponse(answer)).toEqual([
      { name: "model", description: "Switch model", argumentHint: "<name>" },
      { name: "plain" },
    ]);
  });

  test("the unsolicited commands update and other frames are not the answer", () => {
    const update = JSON.stringify({ type: "available_commands_update", commands: [{ name: "x" }] });
    expect(parseOmpCommandsResponse(update)).toBeNull();
    expect(parseOmpCommandsResponse('{"type":"ready"}')).toBeNull();
    expect(parseOmpCommandsResponse("not json")).toBeNull();
  });
});

describe("OmpProbe", () => {
  test("asks in rpc mode without a session, reads the answer, and ends omp", async () => {
    const fake = fakeProcess(['{"type":"ready"}', answer]);
    let spawned: { argv: readonly string[]; cwd: string } | undefined;

    const result = await probeOmpCapabilities({
      cwd: "/repo",
      spawn: (input) => {
        spawned = input;
        return fake.process;
      },
    });

    expect(spawned).toEqual({ argv: OMP_PROBE_ARGV, cwd: "/repo" });
    expect(OMP_PROBE_ARGV).toContain("--no-session");
    expect(JSON.parse(fake.sent[0] ?? "{}")).toEqual({
      id: "cc-mobile-capabilities",
      type: "get_available_commands",
    });
    expect(result.ok).toBe(true);
    expect(fake.killed()).toBe(1);
  });

  test("an omp that never answers times out and is still ended", async () => {
    const fake = fakeProcess(['{"type":"ready"}'], { hang: true });

    const result = await probeOmpCapabilities({
      cwd: "/repo",
      spawn: () => fake.process,
      timeoutMs: 20,
    });

    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(fake.killed()).toBe(1);
  });

  test("an omp that exits without answering is no_response", async () => {
    const fake = fakeProcess(['{"type":"ready"}']);

    const result = await probeOmpCapabilities({ cwd: "/repo", spawn: () => fake.process });

    expect(result).toEqual({ ok: false, reason: "no_response" });
  });

  test("a spawn that throws is spawn_error", async () => {
    const result = await probeOmpCapabilities({
      cwd: "/repo",
      spawn: () => {
        throw new Error("ENOENT");
      },
    });

    expect(result).toEqual({ ok: false, reason: "spawn_error" });
  });
});
