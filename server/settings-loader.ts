import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type SdkPluginConfig = { type: "local"; path: string };

interface InstalledPlugin {
  scope: string;
  installPath: string;
  version: string;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, InstalledPlugin[]>;
}

interface UserSettings {
  enabledPlugins?: Record<string, boolean>;
}

export async function loadUserPlugins(): Promise<SdkPluginConfig[]> {
  const claudeDir = join(homedir(), ".claude");

  let settings: UserSettings;
  try {
    const raw = await readFile(join(claudeDir, "settings.json"), "utf-8");
    settings = JSON.parse(raw);
  } catch {
    console.warn("[settings] could not read ~/.claude/settings.json");
    return [];
  }

  let installed: InstalledPluginsFile;
  try {
    const raw = await readFile(join(claudeDir, "plugins", "installed_plugins.json"), "utf-8");
    installed = JSON.parse(raw);
  } catch {
    console.warn("[settings] could not read ~/.claude/plugins/installed_plugins.json");
    return [];
  }

  const enabled = settings.enabledPlugins ?? {};
  const plugins: SdkPluginConfig[] = [];

  for (const [pluginKey, entries] of Object.entries(installed.plugins)) {
    if (!enabled[pluginKey]) continue;
    const entry = entries[0];
    if (!entry?.installPath) continue;

    plugins.push({ type: "local", path: entry.installPath });
  }

  console.log(`[settings] loaded ${plugins.length} enabled plugins`);
  return plugins;
}
