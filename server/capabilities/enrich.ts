import { homedir } from "node:os";
import { join } from "node:path";
import { readFrontmatter } from "./frontmatter";

export interface PluginInfo {
  name: string;
  path: string;
}

export interface EnrichedCapability {
  name: string;
  description?: string;
  argumentHint?: string;
}

export type FrontmatterReader = (
  file: string,
) => { description?: string; argumentHint?: string } | null;

export function candidates(
  name: string,
  plugins: Map<string, string>,
  home: string,
): string[] {
  const colon = name.indexOf(":");
  if (colon !== -1) {
    const root = plugins.get(name.slice(0, colon));
    if (!root) return [];
    const leaf = name.slice(colon + 1);
    return [
      join(root, "skills", leaf, "SKILL.md"),
      join(root, "commands", `${leaf}.md`),
      join(root, "agents", `${leaf}.md`),
    ];
  }

  return [
    join(home, ".claude", "skills", name, "SKILL.md"),
    join(home, ".claude", "commands", `${name}.md`),
    join(home, ".claude", "agents", `${name}.md`),
  ];
}

export function enrich(
  names: string[],
  {
    plugins = [],
    home = homedir(),
    reader = (file) => readFrontmatter({ file }),
  }: {
    plugins?: PluginInfo[];
    home?: string;
    reader?: FrontmatterReader;
  } = {},
): EnrichedCapability[] {
  const index = new Map(plugins.map((plugin) => [plugin.name, plugin.path]));
  return names.map((name) => {
    for (const file of candidates(name, index, home)) {
      try {
        const fields = reader(file);
        if (fields) return { name, ...fields };
      } catch {
        continue;
      }
    }
    return { name };
  });
}
