export type Theme = "dark" | "light" | "claude" | "ember";
export type ReadingMode = "conversation" | "full";

export interface Settings {
  defaultCwd: string;
  theme: Theme;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
  readingMode: ReadingMode;
}

const SETTINGS_KEY = "cc-mobile-settings";

const defaultSettings: Settings = {
  defaultCwd: "",
  theme: "dark",
  notificationsEnabled: false,
  hapticsEnabled: false,
  readingMode: "conversation",
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
      defaultCwd:
        typeof parsed.defaultCwd === "string" ? parsed.defaultCwd : defaultSettings.defaultCwd,
      theme: ["dark", "light", "claude", "ember"].includes(parsed.theme)
        ? parsed.theme
        : defaultSettings.theme,
      notificationsEnabled:
        typeof parsed.notificationsEnabled === "boolean"
          ? parsed.notificationsEnabled
          : defaultSettings.notificationsEnabled,
      hapticsEnabled:
        typeof parsed.hapticsEnabled === "boolean"
          ? parsed.hapticsEnabled
          : defaultSettings.hapticsEnabled,
      readingMode: parsed.readingMode === "full" ? "full" : defaultSettings.readingMode,
    };
  } catch (error) {
    console.error("[settings] failed to load, using defaults:", error);
    return defaultSettings;
  }
}
