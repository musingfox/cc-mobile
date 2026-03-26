import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function getUploadDir(sessionId: string): string {
  return join(homedir(), ".cache", "cc-mobile", "uploads", sessionId);
}

export async function ensureUploadDir(sessionId: string): Promise<string> {
  const dir = getUploadDir(sessionId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

export async function cleanupUploads(sessionId: string): Promise<void> {
  const dir = getUploadDir(sessionId);
  try {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
      console.log(`[upload-manager] cleaned up uploads for session ${sessionId}`);
    }
  } catch (err) {
    console.warn(`[upload-manager] failed to cleanup uploads for session ${sessionId}:`, err);
  }
}
