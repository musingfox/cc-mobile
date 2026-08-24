import { appendFile, chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_AUDIT_FILE_BYTES = 5 * 1024 * 1024;

export const AUDIT_ACTIONS = [
  "prompt_send",
  "permission_answer",
  "permission_keys_send",
  "auto_deny",
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

export function createAuditLog(
  options: { path?: string; warn?: (message: string) => void } = {},
): AuditLog {
  const path = options.path ?? join(homedir(), ".claude-mobile", "audit", "audit.jsonl");
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
