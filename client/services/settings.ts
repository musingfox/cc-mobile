export type Theme = "dark" | "light" | "claude";

export interface Settings {
  defaultCwd: string;
  theme: Theme;
  notificationsEnabled: boolean;
  voiceInputEnabled: boolean;
  hapticsEnabled: boolean;
  envVars: Record<string, string>;
  model: string;
  effort: string | null;
  permissionMode: string;
}

const SETTINGS_KEY = "cc-mobile-settings";

const defaultSettings: Settings = {
  defaultCwd: "",
  theme: "dark",
  notificationsEnabled: false,
  voiceInputEnabled: false,
  hapticsEnabled: false,
  envVars: {},
  model: "claude-sonnet-4-6",
  effort: null,
  permissionMode: "default",
};

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("[settings] failed to save:", error);
  }
}

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return defaultSettings;
    const parsed = JSON.parse(stored);

    let envVars = defaultSettings.envVars;
    if (parsed.envVars && typeof parsed.envVars === "object" && !Array.isArray(parsed.envVars)) {
      envVars = parsed.envVars;
    }

    return {
      defaultCwd:
        typeof parsed.defaultCwd === "string" ? parsed.defaultCwd : defaultSettings.defaultCwd,
      theme: ["dark", "light", "claude"].includes(parsed.theme)
        ? parsed.theme
        : defaultSettings.theme,
      notificationsEnabled:
        typeof parsed.notificationsEnabled === "boolean"
          ? parsed.notificationsEnabled
          : defaultSettings.notificationsEnabled,
      voiceInputEnabled:
        typeof parsed.voiceInputEnabled === "boolean"
          ? parsed.voiceInputEnabled
          : defaultSettings.voiceInputEnabled,
      hapticsEnabled:
        typeof parsed.hapticsEnabled === "boolean"
          ? parsed.hapticsEnabled
          : defaultSettings.hapticsEnabled,
      envVars,
      model: typeof parsed.model === "string" ? parsed.model : defaultSettings.model,
      effort:
        parsed.effort === null || typeof parsed.effort === "string"
          ? parsed.effort
          : defaultSettings.effort,
      permissionMode:
        typeof parsed.permissionMode === "string"
          ? parsed.permissionMode
          : defaultSettings.permissionMode,
    };
  } catch (error) {
    console.error("[settings] failed to load, using defaults:", error);
    return defaultSettings;
  }
}
