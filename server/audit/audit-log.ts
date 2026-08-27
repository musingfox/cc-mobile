import { appendFile, chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_AUDIT_FILE_BYTES = 5 * 1024 * 1024;

export const AUDIT_ACTIONS = [
  "prompt_send",
  "permission_answer",
  "permission_keys_send",
  "auto_deny_keys_send",
] as const;
export const AUDIT_OUTCOMES = [
  "dispatched",
  "failed",
  "owned",
  "unowned",
  "rejected",
  "sent",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export interface AuditRecordInput {
  action: AuditAction;
  paneId: string | null;
  ip: string | null;
  device: string | null;
  outcome: AuditOutcome;
}

export interface AuditLog {
  append(record: AuditRecordInput): Promise<void>;
  getPath(): string;
}

/**
 * Where the log lives when nobody names a path.
 *
 * `CC_MOBILE_AUDIT_LOG` exists for the one caller injection cannot reach: an
 * e2e that spawns `bun server/index.ts` as a real child process has no seam
 * into `createApp`, and redirecting `HOME` instead would move the herdr socket
 * and claude's transcripts along with it. Whitespace-only counts as unset, the
 * same convention `CC_MOBILE_TRUSTED_USER` uses in `request-gate.ts`.
 */
function defaultAuditLogPath(env: Record<string, string | undefined>): string {
  const override = env.CC_MOBILE_AUDIT_LOG?.trim();
  return override ? override : join(homedir(), ".claude-mobile", "audit", "audit.jsonl");
}

export function createAuditLog(
  options: {
    path?: string;
    warn?: (message: string) => void;
    env?: Record<string, string | undefined>;
  } = {},
): AuditLog {
  const path = options.path ?? defaultAuditLogPath(options.env ?? process.env);
  const warn = options.warn ?? console.warn;
  let warned = false;

  return {
    getPath: () => path,
    async append(record) {
      try {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await chmod(dirname(path), 0o700);
        const current = await stat(path).catch(() => null);
        if (current && current.size >= MAX_AUDIT_FILE_BYTES) {
          await chmod(path, 0o600);
          await rm(`${path}.1`, { force: true });
          await rename(path, `${path}.1`);
        }
        await appendFile(path, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, {
          mode: 0o600,
        });
        await chmod(path, 0o600);
      } catch {
        if (!warned) {
          warned = true;
          warn("audit log write failed");
        }
      }
    },
  };
}
