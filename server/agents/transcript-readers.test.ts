/**
 * AgentTranscriptReaderRegistry — only a kind with a registered reader is ever
 * looked for on disk.
 *
 * Fixture paths mirror the live probe (2026-08-02): session
 * `a21273d4-77e6-43dc-b9cb-3647561d1192` in cwd `/repo`.
 */

import { describe, expect, test } from "bun:test";
import type { TranscriptFs } from "../transcript/path";
import { hasTranscriptReader, resolveAgentTranscriptPath } from "./transcript-readers";

const SESSION = "a21273d4-77e6-43dc-b9cb-3647561d1192";
const PROJECTS = "/home/u/.claude/projects";

/** fs seam that also counts what was asked of it. */
function countingFs(files: string[], entries: string[] = []) {
  const set = new Set(files);
  const counts = { readdir: 0, exists: 0 };
  const fs: TranscriptFs = {
    readdir: async () => {
      counts.readdir += 1;
      return entries;
    },
    exists: async (path) => {
      counts.exists += 1;
      return set.has(path);
    },
  };
  return { fs, counts };
}

describe("AgentTranscriptReaderRegistry", () => {
  test("finds a claude session's transcript", async () => {
    const path = `${PROJECTS}/-repo/${SESSION}.jsonl`;
    const { fs } = countingFs([path], ["-repo"]);

    const resolved = await resolveAgentTranscriptPath({
      agent: "claude",
      sessionValue: SESSION,
      cwd: "/repo",
      projectsDir: PROJECTS,
      fs,
    });

    expect(resolved).toBe(path);
  });

  test("a kind with no reader is not looked for, on disk or anywhere else", async () => {
    const { fs, counts } = countingFs([`${PROJECTS}/-repo/${SESSION}.jsonl`], ["-repo"]);

    const resolved = await resolveAgentTranscriptPath({
      agent: "omp",
      sessionValue: SESSION,
      cwd: "/repo",
      projectsDir: PROJECTS,
      fs,
    });

    // Not merely "no path": claude's layout must not be scanned on another
    // agent's behalf, or the same uuid in a shared projects dir would match.
    expect(resolved).toBeNull();
    expect(counts.readdir).toBe(0);
    expect(counts.exists).toBe(0);
    expect(hasTranscriptReader("omp")).toBe(false);
  });

  test("an undetected kind is not read back either, and never guessed as claude", async () => {
    const { fs, counts } = countingFs([`${PROJECTS}/-repo/${SESSION}.jsonl`], ["-repo"]);

    const resolved = await resolveAgentTranscriptPath({
      sessionValue: SESSION,
      cwd: "/repo",
      projectsDir: PROJECTS,
      fs,
    });

    expect(resolved).toBeNull();
    expect(counts.readdir).toBe(0);
    expect(hasTranscriptReader(undefined)).toBe(false);
  });

  test("a claude pane with no transcript key resolves to nothing", async () => {
    const { fs } = countingFs([`${PROJECTS}/-repo/${SESSION}.jsonl`], ["-repo"]);

    const resolved = await resolveAgentTranscriptPath({
      agent: "claude",
      sessionValue: null,
      cwd: "/repo",
      projectsDir: PROJECTS,
      fs,
    });

    expect(resolved).toBeNull();
    expect(hasTranscriptReader("claude")).toBe(true);
  });
});
