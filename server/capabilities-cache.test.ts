import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { loadCachedCapabilities, saveCachedCapabilities, type Capabilities } from "./capabilities-cache";
import { homedir } from "os";

const CACHE_DIR = join(homedir(), ".claude-mobile");
const CACHE_FILE = join(CACHE_DIR, "capabilities-cache.json");
const BACKUP_FILE = CACHE_FILE + ".backup";

beforeEach(() => {
  // Backup existing cache if present
  if (existsSync(CACHE_FILE)) {
    writeFileSync(BACKUP_FILE, readFileSync(CACHE_FILE));
  }
  // Clean cache file
  if (existsSync(CACHE_FILE)) {
    rmSync(CACHE_FILE);
  }
});

afterEach(() => {
  // Restore backup
  if (existsSync(BACKUP_FILE)) {
    writeFileSync(CACHE_FILE, readFileSync(BACKUP_FILE));
    rmSync(BACKUP_FILE);
  } else if (existsSync(CACHE_FILE)) {
    rmSync(CACHE_FILE);
  }
});

describe("Capabilities cache", () => {
  test("TC13: saveCachedCapabilities writes valid JSON, loadCachedCapabilities reads it back", () => {
    const input: Capabilities = {
      commands: ["/commit", "/review"],
      agents: ["code-reviewer"],
      model: "claude-sonnet-4-6",
    };

    saveCachedCapabilities(input);
    const output = loadCachedCapabilities();

    expect(output).toEqual(input);
  });

  test("TC14: loadCachedCapabilities returns null when file doesn't exist", () => {
    // Ensure file doesn't exist
    if (existsSync(CACHE_FILE)) {
      rmSync(CACHE_FILE);
    }

    const result = loadCachedCapabilities();
    expect(result).toBeNull();
  });

  test("TC15: loadCachedCapabilities returns null when file contains invalid JSON", () => {
    // Write invalid JSON
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(CACHE_FILE, "not json");

    const result = loadCachedCapabilities();
    expect(result).toBeNull();
  });

  test("TC16: saveCachedCapabilities creates directory if it doesn't exist", () => {
    // Delete cache directory if exists
    if (existsSync(CACHE_DIR)) {
      rmSync(CACHE_DIR, { recursive: true });
    }

    const input: Capabilities = {
      commands: ["/commit"],
      agents: [],
      model: "test",
    };

    saveCachedCapabilities(input);

    // Verify directory and file were created
    expect(existsSync(CACHE_DIR)).toBe(true);
    expect(existsSync(CACHE_FILE)).toBe(true);

    const result = loadCachedCapabilities();
    expect(result).toEqual(input);
  });
});
