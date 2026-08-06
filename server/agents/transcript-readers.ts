/**
 * transcript-readers.ts — AgentTranscriptReaderRegistry: which agent kinds
 * cc-mobile can read a conversation back from.
 *
 * The session list carries every pane herdr reports, whatever is running in it
 * (#30). Reading replies back is not that general: the file layout, the record
 * format and the cursor rules are claude's, and pointing them at another
 * agent's pane would either find nothing or find the wrong file. So the lookup
 * is the authority — a kind with no entry here is simply not read, and the disk
 * is never touched on its behalf.
 *
 * Deliberately one map and one lookup: no plugin mechanism, no lifecycle hooks,
 * no config file. Registering the second reader (omp, #32) was one entry.
 *
 * What differs between the two is the *key*, not the reading: claude gets an
 * id it has to locate on disk, omp gets the path itself. The record formats
 * differ too, but that is not routed here — see transcript/records.ts for why
 * one mapper reads both.
 */

import { resolveTranscriptPath, type TranscriptFs } from "../transcript/path";

export interface ResolveAgentTranscriptInput {
  /**
   * The kind herdr detected, verbatim. `undefined` means it has not said yet —
   * which reads as "no reader", never as claude: guessing would send the
   * claude resolver hunting through `~/.claude/projects` for another agent's id.
   */
  agent?: string;
  /** The agent's own transcript key; `null` on a pane herdr has none for. */
  sessionValue: string | null;
  /**
   * What that key is, in herdr's words: `"path"` (the file itself) or `"id"`
   * (a name to locate). herdr keeps a path only for `pi` and `omp`; every other
   * agent gets an id. Absent when it did not say.
   */
  sessionKind?: string;
  /** The pane's cwd verbatim. */
  cwd: string;
  projectsDir?: string;
  fs?: TranscriptFs;
}

/** One kind's answer to "where does this session's conversation live". */
export interface AgentTranscriptReader {
  /** Absolute path to the conversation file, or `null` when it cannot be found. */
  resolvePath(input: ResolveAgentTranscriptInput): Promise<string | null>;
}

/**
 * kind → reader. Keyed `string | undefined` so an undetected kind misses by
 * lookup rather than by a special case at every call site.
 */
const READERS = new Map<string | undefined, AgentTranscriptReader>([
  ["claude", { resolvePath: (input) => resolveTranscriptPath(input) }],
  ["omp", { resolvePath: async (input) => pathKeyOrNull(input.sessionKind, input.sessionValue) }],
]);

/**
 * omp needs no resolution at all: herdr hands back the file itself
 * (`kind:"path"`, probe 2026-08-06), so claude's derive-and-scan is not just
 * unnecessary here, it would be wrong — it hunts through `~/.claude/projects`.
 *
 * Anything that is not an absolute path under a `path` key is refused rather
 * than passed on: this value is opened for reading, and a relative or empty one
 * would resolve against the server's cwd.
 */
function pathKeyOrNull(
  sessionKind: string | undefined,
  sessionValue: string | null,
): string | null {
  if (sessionKind !== "path" || !sessionValue?.startsWith("/")) return null;
  return sessionValue;
}

/** The reader for a kind, or `undefined` when that kind cannot be read back. */
export function transcriptReaderFor(agent: string | undefined): AgentTranscriptReader | undefined {
  return READERS.get(agent);
}

/** Whether replies from this kind can be read back at all. */
export function hasTranscriptReader(agent: string | undefined): boolean {
  return transcriptReaderFor(agent) !== undefined;
}

/**
 * The registered reader's answer, or `null` with no disk access at all when the
 * kind has none.
 */
export async function resolveAgentTranscriptPath(
  input: ResolveAgentTranscriptInput,
): Promise<string | null> {
  const reader = transcriptReaderFor(input.agent);
  if (!reader) return null;
  return reader.resolvePath(input);
}
