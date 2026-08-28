import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentProfileSource } from "./profiles";

const REAL_PATH = process.env.PATH;

function pathWithOnly(names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ccm-profiles-bin-"));
  for (const name of names) {
    writeFileSync(join(dir, name), "#!/bin/sh\n", { mode: 0o755 });
  }
  return dir;
}

function profileFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ccm-profiles-"));
  const path = join(dir, "agent-profiles.json");
  writeFileSync(path, content);
  return path;
}

beforeEach(() => {
  process.env.PATH = pathWithOnly(["omp"]);
});

afterEach(() => {
  process.env.PATH = REAL_PATH;
});

describe("AgentProfileFileLoad", () => {
  test("a missing file yields no profiles", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ccm-profiles-missing-")), "missing.json");

    expect(createAgentProfileSource({ path }).list()).toEqual([]);
  });

  test("a valid available profile is loaded unchanged", () => {
    const path = profileFile(
      JSON.stringify([
        {
          id: "omp-codex",
          label: "omp · codex",
          kind: "omp",
          args: ["--config", "/x.yml"],
        },
      ]),
    );

    expect(createAgentProfileSource({ path }).list()).toEqual([
      {
        id: "omp-codex",
        label: "omp · codex",
        kind: "omp",
        args: ["--config", "/x.yml"],
      },
    ]);
  });

  test("omitted args default to an empty list", () => {
    const path = profileFile(JSON.stringify([{ id: "bare", label: "Bare omp", kind: "omp" }]));

    expect(createAgentProfileSource({ path }).list()).toEqual([
      { id: "bare", label: "Bare omp", kind: "omp", args: [] },
    ]);
  });

  test("malformed JSON yields no profiles and warns once", () => {
    const warn = mock(() => {});
    const source = createAgentProfileSource({ path: profileFile('{"broken":'), warn });

    expect(source.list()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("an unknown kind is dropped without losing valid entries", () => {
    const path = profileFile(
      JSON.stringify([
        { id: "a", label: "A", kind: "codex", args: [] },
        { id: "b", label: "B", kind: "omp", args: [] },
      ]),
    );

    expect(createAgentProfileSource({ path }).list()).toEqual([
      { id: "b", label: "B", kind: "omp", args: [] },
    ]);
  });

  test("an empty id or label is dropped without losing valid entries", () => {
    // Both are unlaunchable rather than merely ugly: `profileId: ""` fails the
    // wire schema, so nothing can ever ask for the first entry, and the second
    // would render a button with no text on it.
    const path = profileFile(
      JSON.stringify([
        { id: "", label: "No id", kind: "omp", args: [] },
        { id: "no-label", label: "", kind: "omp", args: [] },
        { id: "ok", label: "OK", kind: "omp", args: [] },
      ]),
    );

    expect(createAgentProfileSource({ path }).list()).toEqual([
      { id: "ok", label: "OK", kind: "omp", args: [] },
    ]);
  });

  test("a profile is dropped when its kind is unavailable", () => {
    process.env.PATH = pathWithOnly(["claude"]);
    const path = profileFile(JSON.stringify([{ id: "a", label: "A", kind: "omp" }]));

    expect(createAgentProfileSource({ path }).list()).toEqual([]);
  });

  test("the first duplicate id wins", () => {
    const path = profileFile(
      JSON.stringify([
        { id: "a", label: "first", kind: "omp", args: [] },
        { id: "a", label: "second", kind: "omp", args: [] },
      ]),
    );

    expect(createAgentProfileSource({ path }).list()).toEqual([
      { id: "a", label: "first", kind: "omp", args: [] },
    ]);
  });

  test("operator args pass through without a denylist", () => {
    const path = profileFile(
      JSON.stringify([
        { id: "loose", label: "Loose", kind: "omp", args: ["--auto-approve"] },
      ]),
    );

    expect(createAgentProfileSource({ path }).list()).toEqual([
      { id: "loose", label: "Loose", kind: "omp", args: ["--auto-approve"] },
    ]);
  });

  test("each list call reads the file again", () => {
    const path = profileFile(JSON.stringify([{ id: "a", label: "A", kind: "omp" }]));
    const source = createAgentProfileSource({ path });

    expect(source.list()).toHaveLength(1);
    writeFileSync(
      path,
      JSON.stringify([
        { id: "a", label: "A", kind: "omp" },
        { id: "b", label: "B", kind: "omp" },
      ]),
    );
    expect(source.list()).toHaveLength(2);
  });
});
