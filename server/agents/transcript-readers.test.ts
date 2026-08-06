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
      agent: "codex",
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
    expect(hasTranscriptReader("codex")).toBe(false);
  });

  test("an omp path key is the answer, with no directory scan at all", async () => {
    // Live shape (probe 2026-08-06): herdr hands omp's file back directly,
    // `{value:"/abs/….jsonl", agent:"omp", kind:"path", source:"herdr:omp"}`.
    const OMP_PATH = "/home/u/.omp/agent/sessions/-repo/2026-08-06T13-53-02-265Z_019fd759.jsonl";
    const { fs, counts } = countingFs([], []);

    const resolved = await resolveAgentTranscriptPath({
      agent: "omp",
      sessionValue: OMP_PATH,
      sessionKind: "path",
      cwd: "/repo",
      projectsDir: PROJECTS,
      fs,
    });

    expect(resolved).toBe(OMP_PATH);
    // The whole point of the path key: claude's derive-and-scan never runs.
    expect(counts.readdir).toBe(0);
    expect(counts.exists).toBe(0);
    expect(hasTranscriptReader("omp")).toBe(true);
  });

  test("an omp key that is not an absolute path is refused rather than opened", async () => {
    const { fs, counts } = countingFs([], []);

    for (const [sessionKind, sessionValue] of [
      // An id-kind key from a future herdr: locating it is claude's logic, and
      // running that here would hunt through ~/.claude/projects for an omp.
      ["id", SESSION],
      // Relative or empty would resolve against the server's own cwd.
      ["path", "sessions/x.jsonl"],
      ["path", ""],
      [undefined, "/abs/x.jsonl"],
    ] as const) {
      const resolved = await resolveAgentTranscriptPath({
        agent: "omp",
        sessionValue,
        sessionKind,
        cwd: "/repo",
        projectsDir: PROJECTS,
        fs,
      });
      expect(resolved).toBeNull();
    }
    expect(counts.readdir).toBe(0);
    expect(counts.exists).toBe(0);
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
