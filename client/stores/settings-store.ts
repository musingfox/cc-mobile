import { create } from "zustand";
import { loadSettings, saveSettings, type Theme } from "../services/settings";

interface SettingsState {
  defaultCwd: string;
  theme: Theme;
  setDefaultCwd: (cwd: string) => void;
  setTheme: (theme: Theme) => void;
}

export const useSettingsStore = create<SettingsState>((set) => {
  const initialSettings = loadSettings();

  return {
    defaultCwd: initialSettings.defaultCwd,
    theme: initialSettings.theme,
    setDefaultCwd: (cwd) =>
      set((state) => {
        const newSettings = { ...state, defaultCwd: cwd };
        saveSettings(newSettings);
        return { defaultCwd: cwd };
      }),
    setTheme: (theme) =>
      set((state) => {
        const newSettings = { ...state, theme };
        saveSettings(newSettings);
        return { theme };
      }),
  };
});
