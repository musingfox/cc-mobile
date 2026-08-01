import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Capabilities, loadCachedCapabilities } from "./capabilities-cache";

const CACHE_DIR = join(homedir(), ".claude-mobile");
const CACHE_FILE = join(CACHE_DIR, "capabilities-cache.json");
const BACKUP_FILE = `${CACHE_FILE}.backup`;

/**
 * Lay a cache file down by hand. Since #25 the module has no writer of its own
 * — the cache is whatever a pre-#25 run (or an operator) left on disk.
 */
function writeCacheFile(caps: Capabilities): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  writeFileSync(CACHE_FILE, JSON.stringify(caps, null, 2), "utf-8");
}

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
  test("TC13: loadCachedCapabilities reads back a cache file written to disk", () => {
    const input: Capabilities = {
      commands: [{ name: "/commit" }, { name: "/review" }],
      agents: [{ name: "code-reviewer" }],
      model: "claude-sonnet-4-6",
    };

    writeCacheFile(input);
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

  test("C1-TC1: persists and reloads models and accountInfo", () => {
    const input: Capabilities = {
      commands: [{ name: "a" }],
      agents: [],
      model: "claude-sonnet-4-6",
      models: [{ value: "x", displayName: "X", description: "" }],
      accountInfo: { email: "e@x" },
    };

    writeCacheFile(input);
    const output = loadCachedCapabilities();

    expect(output).toEqual(input);
  });

  test("C1-TC2: loads old cache shape without models/accountInfo", () => {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }

    writeFileSync(
      CACHE_FILE,
      JSON.stringify({ commands: [], agents: [], model: "m" }, null, 2),
      "utf-8",
    );

    const result = loadCachedCapabilities();
    expect(result).toEqual({ commands: [], agents: [], model: "m" });
  });

  test("TC16: a missing cache directory reads as no cache, not as an error", () => {
    // Delete cache directory if exists
    if (existsSync(CACHE_DIR)) {
      rmSync(CACHE_DIR, { recursive: true });
    }

    expect(() => loadCachedCapabilities()).not.toThrow();
    expect(loadCachedCapabilities()).toBeNull();
  });

  test("T4.6: old format cache file (string arrays) loads and normalizes to object arrays", () => {
    // Write old format directly to disk
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    const oldFormat = {
      commands: ["/help", "/commit"],
      agents: ["a1"],
      model: "test-model",
    };
    writeFileSync(CACHE_FILE, JSON.stringify(oldFormat, null, 2), "utf-8");

    const result = loadCachedCapabilities();
    expect(result).toEqual({
      commands: [{ name: "/help" }, { name: "/commit" }],
      agents: [{ name: "a1" }],
      model: "test-model",
    });
  });
});
