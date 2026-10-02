import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupUploads, ensureUploadDir, getUploadDir } from "../upload-manager";

const uploadsRoot = mkdtempSync(join(tmpdir(), "upload-manager-test-"));

afterAll(() => {
  rmSync(uploadsRoot, { recursive: true, force: true });
});

describe("Upload manager", () => {
  test("C6-TC1: cleanupUploads deletes existing session directory", async () => {
    const sessionId = `sess-cleanup-test-${Date.now()}`;
    const uploadDir = getUploadDir(sessionId, uploadsRoot);

    // Create the directory and add a file
    await ensureUploadDir(sessionId, uploadsRoot);
    const testFile = join(uploadDir, "test.txt");
    writeFileSync(testFile, "test content");

    expect(existsSync(uploadDir)).toBe(true);
    expect(existsSync(testFile)).toBe(true);

    // Cleanup
    await cleanupUploads(sessionId, uploadsRoot);

    // Verify directory and file are deleted
    expect(existsSync(uploadDir)).toBe(false);
    expect(existsSync(testFile)).toBe(false);
  });

  test("C6-TC2: cleanupUploads is no-op for non-existent directory", async () => {
    const sessionId = `sess-nonexistent-${Date.now()}`;
    const uploadDir = getUploadDir(sessionId, uploadsRoot);

    expect(existsSync(uploadDir)).toBe(false);

    // Should not throw
    await expect(cleanupUploads(sessionId, uploadsRoot)).resolves.toBeUndefined();

    // Still doesn't exist
    expect(existsSync(uploadDir)).toBe(false);
  });

  test("C6-TC3: cleanupUploads deletes nested files and directories", async () => {
    const sessionId = `sess-nested-${Date.now()}`;
    const uploadDir = getUploadDir(sessionId, uploadsRoot);

    // Create nested structure
    await ensureUploadDir(sessionId, uploadsRoot);
    const subDir = join(uploadDir, "subdir");
    mkdirSync(subDir);
    writeFileSync(join(uploadDir, "file1.txt"), "content1");
    writeFileSync(join(subDir, "file2.txt"), "content2");

    expect(existsSync(uploadDir)).toBe(true);

    // Cleanup
    await cleanupUploads(sessionId, uploadsRoot);

    // Verify everything is deleted
    expect(existsSync(uploadDir)).toBe(false);
    expect(existsSync(subDir)).toBe(false);
  });

  test("C6-TC4: without a root, the upload dir is the production default under the home cache", () => {
    const sessionId = "test-session-123";
    expect(getUploadDir(sessionId)).toBe(
      join(homedir(), ".cache", "cc-mobile", "uploads", sessionId),
    );
  });

  test("C6-TC4b: an injected root replaces the default and nothing else", () => {
    expect(getUploadDir("test-session-123", uploadsRoot)).toBe(
      join(uploadsRoot, "test-session-123"),
    );
  });

  test("C6-TC5: ensureUploadDir creates directory recursively", async () => {
    const sessionId = `sess-ensure-${Date.now()}`;
    const uploadDir = getUploadDir(sessionId, uploadsRoot);

    expect(existsSync(uploadDir)).toBe(false);

    await ensureUploadDir(sessionId, uploadsRoot);

    expect(existsSync(uploadDir)).toBe(true);

    // Cleanup
    await cleanupUploads(sessionId, uploadsRoot);
  });
});
