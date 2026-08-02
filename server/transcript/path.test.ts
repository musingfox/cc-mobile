/**
 * TranscriptPathResolve — locating a conversation's JSONL from its session id.
 *
 * Fixture paths mirror the live probe (2026-08-02): session
 * `a21273d4-77e6-43dc-b9cb-3647561d1192` in cwd `/private/tmp/probe/cwd`.
 */

import { describe, expect, it } from "bun:test";
import { projectDirNameFor, resolveTranscriptPath, type TranscriptFs } from "./path";

const SESSION = "a21273d4-77e6-43dc-b9cb-3647561d1192";
const PROJECTS = "/home/u/.claude/projects";

/** fs seam backed by a set of existing paths and a directory listing. */
function fakeFs(files: string[], entries: string[] = []): TranscriptFs {
  const set = new Set(files);
  return {
    readdir: async () => entries,
    exists: async (path) => set.has(path),
  };
}

describe("TranscriptPathResolve", () => {
  it("resolves the file under the encoded cwd directory", async () => {
    const dir = `${PROJECTS}/-private-tmp-probe-cwd`;
    const path = `${dir}/${SESSION}.jsonl`;
    expect(projectDirNameFor("/private/tmp/probe/cwd")).toBe("-private-tmp-probe-cwd");

    const resolved = await resolveTranscriptPath({
      sessionValue: SESSION,
      cwd: "/private/tmp/probe/cwd",
      projectsDir: PROJECTS,
      fs: fakeFs([path], ["-private-tmp-probe-cwd"]),
    });

    expect(resolved).toBe(path);
  });

  it("finds a directory the encoding rule would never produce (scan wins over the rule)", async () => {
    // A cwd with a space: the rule encodes it to `-Users-nick-my-project`, but
    // the real directory on disk is `-Users-nick-my project`.
    const realDir = "-Users-nick-my project";
    const path = `${PROJECTS}/${realDir}/${SESSION}.jsonl`;

    const resolved = await resolveTranscriptPath({
      sessionValue: SESSION,
      cwd: "/Users/nick/my project",
      projectsDir: PROJECTS,
      fs: fakeFs([path], ["-other-project", realDir]),
    });

    expect(resolved).toBe(path);
  });

  it("returns null when the session has no id", async () => {
    const resolved = await resolveTranscriptPath({
      sessionValue: null,
      cwd: "/x",
      projectsDir: PROJECTS,
      fs: fakeFs([`${PROJECTS}/-x/${SESSION}.jsonl`], ["-x"]),
    });

    expect(resolved).toBeNull();
  });

  it("returns null when no directory holds the file", async () => {
    const resolved = await resolveTranscriptPath({
      sessionValue: SESSION,
      cwd: "/private/tmp/probe/cwd",
      projectsDir: PROJECTS,
      fs: fakeFs([`${PROJECTS}/-a/other.jsonl`], ["-a", "-b"]),
    });

    expect(resolved).toBeNull();
  });

  it("returns null instead of throwing when readdir fails", async () => {
    const fs: TranscriptFs = {
      readdir: async () => {
        throw new Error("EACCES");
      },
      exists: async () => false,
    };

    const resolved = await resolveTranscriptPath({
      sessionValue: SESSION,
      cwd: "/private/tmp/probe/cwd",
      projectsDir: PROJECTS,
      fs,
    });

    expect(resolved).toBeNull();
  });
});
