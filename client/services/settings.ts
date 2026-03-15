export type Theme = "dark" | "light" | "claude";

export interface Settings {
  defaultCwd: string;
  theme: Theme;
}

const SETTINGS_KEY = "claude-code-mobile-settings";

const defaultSettings: Settings = {
  defaultCwd: "",
  theme: "dark",
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
    return {
      defaultCwd: typeof parsed.defaultCwd === "string" ? parsed.defaultCwd : defaultSettings.defaultCwd,
      theme: ["dark", "light", "claude"].includes(parsed.theme) ? parsed.theme : defaultSettings.theme,
    };
  } catch (error) {
    console.error("[settings] failed to load, using defaults:", error);
    return defaultSettings;
  }
}
