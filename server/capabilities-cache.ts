import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentInfo, CommandInfo } from "./protocol";

export type Capabilities = {
  commands: CommandInfo[];
  agents: AgentInfo[];
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
      // Normalize old format: string[] → {name: string}[]
      const normalizeToInfo = <T extends { name: string }>(arr: unknown[]): T[] => {
        if (arr.length === 0) return [];
        return typeof arr[0] === "string" ? arr.map((name) => ({ name }) as T) : (arr as T[]);
      };

      return {
        commands: normalizeToInfo<CommandInfo>(parsed.commands),
        agents: normalizeToInfo<AgentInfo>(parsed.agents),
        model: parsed.model,
      };
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
