/**
 * path.ts — TranscriptPathResolve: claude session value → on-disk JSONL path.
 *
 * claude stores one conversation per file at
 * `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`, where the directory
 * name is `cwd.replace(/[^a-zA-Z0-9]/g, "-")`. herdr never reports that path
 * (its hook sends `agent_session_path` but the daemon discards it for claude —
 * see research §Constraints), so cc-mobile derives it.
 *
 * The encoding rule is only a *fast path* here. It was verified forward for
 * `/`, `.`, `-`, `_` and alphanumerics over 27 real project dirs (probe
 * 2026-08-02) and never for spaces or non-ASCII, and it is lossy in reverse
 * (`/a/b`, `/a-b`, `/a_b` all collide) — so when the encoded directory does not
 * hold the file, every project directory is scanned for `<value>.jsonl`
 * instead. One readdir over ~58 dirs removes the character-class risk and also
 * covers a session whose cwd drifted after launch (Decision M2).
 *
 * Never throws: an unreadable projects dir is a session with no readback, not a
 * server error.
 */

import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Injected fs seam — the whole module is testable without touching disk. */
export interface TranscriptFs {
  /** Entry names directly under `dir`. May reject. */
  readdir(dir: string): Promise<string[]>;
  /** True when `path` is readable. Must not reject. */
  exists(path: string): Promise<boolean>;
}

export const defaultTranscriptFs: TranscriptFs = {
  readdir: (dir) => readdir(dir),
  exists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
};

/** `~/.claude/projects` — where claude keeps every conversation transcript. */
export function defaultProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * claude's forward encoding of a cwd into a project directory name. Derive
 * forward only: the mapping cannot be inverted (research §Transcript read
 * contract).
 */
export function projectDirNameFor(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export interface ResolveTranscriptPathInput {
  /** `agent_session.value`; `null` on a pane herdr has no session id for. */
  sessionValue: string | null;
  /** The pane's cwd verbatim — macOS reports `/private/tmp/...`, not `/tmp/...`. */
  cwd: string;
  projectsDir?: string;
  fs?: TranscriptFs;
}

/**
 * Absolute path to the conversation's JSONL file, or `null` when it cannot be
 * located (no session value, no such file anywhere, unreadable projects dir).
 */
export async function resolveTranscriptPath(
  input: ResolveTranscriptPathInput,
): Promise<string | null> {
  const { sessionValue, cwd } = input;
  if (!sessionValue) return null;

  const projectsDir = input.projectsDir ?? defaultProjectsDir();
  const fs = input.fs ?? defaultTranscriptFs;
  const fileName = `${sessionValue}.jsonl`;

  // Fast path: the encoded cwd, one stat.
  try {
    const encoded = join(projectsDir, projectDirNameFor(cwd), fileName);
    if (await fs.exists(encoded)) return encoded;
  } catch {
    // A throwing seam is treated exactly as "not there" — the scan still runs.
  }

  // Scan: the rule may not describe this cwd at all (spaces, non-ASCII, a cwd
  // that changed since launch).
  try {
    const entries = await fs.readdir(projectsDir);
    for (const entry of entries) {
      const candidate = join(projectsDir, entry, fileName);
      if (await fs.exists(candidate)) return candidate;
    }
  } catch {
    // Unreadable projects dir: degraded, not fatal.
    return null;
  }

  return null;
}
