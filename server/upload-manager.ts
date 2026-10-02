import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const SAFE_SESSION_RE = /^[A-Za-z0-9_-]+$/;
export const DEFAULT_UPLOADS_ROOT = join(homedir(), ".cache", "cc-mobile", "uploads");

export function safeSessionDir(sessionId: string, uploadsRoot = DEFAULT_UPLOADS_ROOT): string {
  if (!sessionId || !SAFE_SESSION_RE.test(sessionId)) {
    throw new Error("invalid sessionId");
  }
  const dir = join(uploadsRoot, sessionId);
  if (!resolve(dir).startsWith(resolve(uploadsRoot) + sep)) {
    throw new Error("invalid sessionId");
  }
  return dir;
}

export function getUploadDir(sessionId: string, uploadsRoot = DEFAULT_UPLOADS_ROOT): string {
  return safeSessionDir(sessionId, uploadsRoot);
}

export async function ensureUploadDir(
  sessionId: string,
  uploadsRoot = DEFAULT_UPLOADS_ROOT,
): Promise<string> {
  const dir = getUploadDir(sessionId, uploadsRoot);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

export async function cleanupUploads(
  sessionId: string,
  uploadsRoot = DEFAULT_UPLOADS_ROOT,
): Promise<void> {
  const dir = getUploadDir(sessionId, uploadsRoot);
  try {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
      console.log(`[upload-manager] cleaned up uploads for session ${sessionId}`);
    }
  } catch (err) {
    console.warn(`[upload-manager] failed to cleanup uploads for session ${sessionId}:`, err);
  }
}
