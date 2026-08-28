import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  isAgentKindAvailable,
  LAUNCHABLE_AGENT_KINDS,
  type LaunchableAgentKind,
} from "./kinds";

export interface AgentProfile {
  id: string;
  label: string;
  kind: LaunchableAgentKind;
  args: string[];
}

export interface AgentProfileSource {
  list(): AgentProfile[];
}

const AgentProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(LAUNCHABLE_AGENT_KINDS),
  args: z.array(z.string()).default([]),
});

function defaultProfilePath(env: Record<string, string | undefined>): string {
  const override = env.CC_MOBILE_AGENT_PROFILES?.trim();
  return override ? override : join(homedir(), ".claude-mobile", "agent-profiles.json");
}

export function createAgentProfileSource(
  options: {
    path?: string;
    env?: Record<string, string | undefined>;
    warn?: (message: string) => void;
  } = {},
): AgentProfileSource {
  const path = options.path ?? defaultProfilePath(options.env ?? process.env);
  const warn = options.warn ?? console.warn;
  let warned = false;

  return {
    list() {
      let input: unknown;
      try {
        input = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        if (!warned) {
          warned = true;
          warn(`Could not read agent profiles from ${path}`);
        }
        return [];
      }

      if (!Array.isArray(input)) {
        if (!warned) {
          warned = true;
          warn(`Agent profiles file is not an array: ${path}`);
        }
        return [];
      }

      const profiles: AgentProfile[] = [];
      const ids = new Set<string>();
      for (const entry of input) {
        const parsed = AgentProfileSchema.safeParse(entry);
        if (
          !parsed.success ||
          ids.has(parsed.data.id) ||
          !isAgentKindAvailable(parsed.data.kind)
        ) {
          continue;
        }
        ids.add(parsed.data.id);
        profiles.push(parsed.data);
      }
      return profiles;
    },
  };
}

export function emptyAgentProfileSource(): AgentProfileSource {
  return { list: () => [] };
}
