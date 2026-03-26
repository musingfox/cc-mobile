import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupUploads, ensureUploadDir, getUploadDir } from "../upload-manager";

describe("Upload manager", () => {
  test("C6-TC1: cleanupUploads deletes existing session directory", async () => {
    const sessionId = `sess-cleanup-test-${Date.now()}`;
    const uploadDir = getUploadDir(sessionId);

    // Create the directory and add a file
    await ensureUploadDir(sessionId);
    const testFile = join(uploadDir, "test.txt");
    writeFileSync(testFile, "test content");

    expect(existsSync(uploadDir)).toBe(true);
    expect(existsSync(testFile)).toBe(true);

    // Cleanup
    await cleanupUploads(sessionId);

    // Verify directory and file are deleted
    expect(existsSync(uploadDir)).toBe(false);
    expect(existsSync(testFile)).toBe(false);
  });

  test("C6-TC2: cleanupUploads is no-op for non-existent directory", async () => {
    const sessionId = `sess-nonexistent-${Date.now()}`;
    const uploadDir = getUploadDir(sessionId);

    expect(existsSync(uploadDir)).toBe(false);

    // Should not throw
    await expect(cleanupUploads(sessionId)).resolves.toBeUndefined();

    // Still doesn't exist
    expect(existsSync(uploadDir)).toBe(false);
  });

  test("C6-TC3: cleanupUploads deletes nested files and directories", async () => {
    const sessionId = `sess-nested-${Date.now()}`;
    const uploadDir = getUploadDir(sessionId);

    // Create nested structure
    await ensureUploadDir(sessionId);
    const subDir = join(uploadDir, "subdir");
    mkdirSync(subDir);
    writeFileSync(join(uploadDir, "file1.txt"), "content1");
    writeFileSync(join(subDir, "file2.txt"), "content2");

    expect(existsSync(uploadDir)).toBe(true);

    // Cleanup
    await cleanupUploads(sessionId);

    // Verify everything is deleted
    expect(existsSync(uploadDir)).toBe(false);
    expect(existsSync(subDir)).toBe(false);
  });

  test("C6-TC4: getUploadDir returns correct path structure", () => {
    const sessionId = "test-session-123";
    const uploadDir = getUploadDir(sessionId);

    expect(uploadDir).toContain(".cache");
    expect(uploadDir).toContain("cc-mobile");
    expect(uploadDir).toContain("uploads");
    expect(uploadDir).toContain(sessionId);
  });

  test("C6-TC5: ensureUploadDir creates directory recursively", async () => {
    const sessionId = `sess-ensure-${Date.now()}`;
    const uploadDir = getUploadDir(sessionId);

    expect(existsSync(uploadDir)).toBe(false);

    await ensureUploadDir(sessionId);

    expect(existsSync(uploadDir)).toBe(true);

    // Cleanup
    await cleanupUploads(sessionId);
  });
});
