import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export type Capabilities = {
  commands: string[];
  agents: string[];
  model: string;
};

const CACHE_DIR = join(homedir(), ".claude-mobile");
const CACHE_FILE = join(CACHE_DIR, "capabilities-cache.json");

/**
 * Load cached capabilities from disk.
 * Returns null if file doesn't exist or contains invalid JSON.
 * Errors are silently caught (cache is best-effort).
 */
export function loadCachedCapabilities(): Capabilities | null {
  try {
    if (!existsSync(CACHE_FILE)) {
      return null;
    }
    const data = readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(data);

    // Basic validation
    if (
      typeof parsed === "object" &&
      Array.isArray(parsed.commands) &&
      Array.isArray(parsed.agents) &&
      typeof parsed.model === "string"
    ) {
      return parsed as Capabilities;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save capabilities to disk cache.
 * Creates directory if it doesn't exist.
 * Errors are silently caught (cache is best-effort).
 */
export function saveCachedCapabilities(caps: Capabilities): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify(caps, null, 2), "utf-8");
  } catch {
    // Silently fail - cache is best-effort
  }
}
