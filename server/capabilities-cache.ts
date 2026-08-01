/**
 * capabilities-cache.ts — read side of the on-disk slash-command / agent cache.
 *
 * TODO(#25-followup): read-only since #25. The writer lived on the SDK query
 * path (the `system`/`init` message carried the lists); with that path gone
 * nothing refreshes this file, so what is returned here is whatever a pre-#25
 * run left on disk — and `null` on a machine that never had one.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AccountInfo, AgentInfo, CommandInfo, ModelInfo } from "./protocol";

export type Capabilities = {
  commands: CommandInfo[];
  agents: AgentInfo[];
  model: string;
  models?: ModelInfo[];
  accountInfo?: AccountInfo;
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

      const normalized: Capabilities = {
        commands: normalizeToInfo<CommandInfo>(parsed.commands),
        agents: normalizeToInfo<AgentInfo>(parsed.agents),
        model: parsed.model,
      };

      if (Array.isArray(parsed.models)) {
        normalized.models = parsed.models as ModelInfo[];
      }
      if (parsed.accountInfo && typeof parsed.accountInfo === "object") {
        normalized.accountInfo = parsed.accountInfo as AccountInfo;
      }

      return normalized;
    }
    return null;
  } catch {
    return null;
  }
}
