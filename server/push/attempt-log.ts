/**
 * attempt-log.ts — one line per push attempt, on disk.
 *
 * This file is the ticket's deliverable: after a physical-device test the human
 * reads it to tell "we never sent" from "we sent and Apple said 410" from "we
 * sent and the phone stayed quiet". A logging failure must never break a send,
 * so every write is swallowed — but swallowed silently once meant an operator
 * with an unwritable `~/.claude-mobile/` saw exactly what a working install
 * saw: nothing. Hence the one warning.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_DIR = join(homedir(), ".claude-mobile");
const DEFAULT_PATH = join(DEFAULT_DIR, "push-attempts.jsonl");
const MAX_BYTES = 256 * 1024;

export interface AttemptRecord {
  ts: string;
  kind: "turn" | "permission";
  host: string;
  status: number | null;
  reason: string | null;
}

export interface AttemptInput {
  kind: "turn" | "permission";
  endpoint: string;
  status?: number | null;
  reason?: string | null;
}

export interface AttemptLog {
  append(record: AttemptInput): Promise<void>;
  /** for tests only */
  getPath(): string;
}

export function createAttemptLog(
  opts: { path?: string; warn?: (message: string) => void } = {},
): AttemptLog {
  const path = opts.path ?? DEFAULT_PATH;
  const warn = opts.warn ?? ((message: string) => console.warn(`[push] ${message}`));
  // Once per log instance — one per process in production. A broken log path
  // stays broken, and a line per attempt would drown the attempts themselves.
  let warnedUnwritable = false;

  function reportUnwritable(error: unknown) {
    if (warnedUnwritable) return;
    warnedUnwritable = true;
    warn(
      `cannot write the push attempt log at ${path} (${String(error)}) — attempts go unrecorded`,
    );
  }

  async function append(rec: AttemptInput): Promise<void> {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      // A malformed endpoint must not cost the line; the host column is
      // diagnostic, not structural.
      let host: string;
      try {
        host = new URL(rec.endpoint).host;
      } catch {
        host = "unknown";
      }

      const line = `${JSON.stringify({
        ts: new Date().toISOString(),
        kind: rec.kind,
        host,
        status: rec.status ?? null,
        reason: rec.reason ?? null,
      } satisfies AttemptRecord)}\n`;

      appendFileSync(path, line);
      trim();
    } catch (error) {
      reportUnwritable(error);
    }
  }

  /** Keeps the newest half once the file passes the cap. */
  function trim() {
    try {
      if (statSync(path).size <= MAX_BYTES) return;
      const data = readFileSync(path, "utf8");
      let kept = data.trim().split("\n").filter(Boolean);
      let out = data;
      while (Buffer.byteLength(out) > MAX_BYTES && kept.length > 1) {
        kept = kept.slice(1);
        out = `${kept.join("\n")}\n`;
      }
      writeFileSync(path, out);
    } catch {
      // Trimming is housekeeping; a failure here already got its warning from
      // the append that could not write either, or is a transient stat race.
    }
  }

  return {
    append,
    getPath: () => path,
  };
}
