import { create } from "zustand";
import { loadSettings, type ReadingMode, saveSettings, type Theme } from "../services/settings";

interface SettingsState {
  defaultCwd: string;
  theme: Theme;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
  readingMode: ReadingMode;
  setDefaultCwd: (cwd: string) => void;
  setTheme: (theme: Theme) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setReadingMode: (mode: ReadingMode) => void;
}

function persist(state: SettingsState): void {
  saveSettings({
    defaultCwd: state.defaultCwd,
    theme: state.theme,
    notificationsEnabled: state.notificationsEnabled,
    hapticsEnabled: state.hapticsEnabled,
    readingMode: state.readingMode,
  });
}

export const useSettingsStore = create<SettingsState>((set) => {
  const initialSettings = loadSettings();

  return {
    defaultCwd: initialSettings.defaultCwd,
    theme: initialSettings.theme,
    notificationsEnabled: initialSettings.notificationsEnabled,
    hapticsEnabled: initialSettings.hapticsEnabled,
    readingMode: initialSettings.readingMode,
    setDefaultCwd: (cwd) =>
      set((state) => {
        persist({ ...state, defaultCwd: cwd });
        return { defaultCwd: cwd };
      }),
    setTheme: (theme) =>
      set((state) => {
        persist({ ...state, theme });
        return { theme };
      }),
    setNotificationsEnabled: (enabled) =>
      set((state) => {
        persist({ ...state, notificationsEnabled: enabled });
        return { notificationsEnabled: enabled };
      }),
    setHapticsEnabled: (enabled) =>
      set((state) => {
        persist({ ...state, hapticsEnabled: enabled });
        return { hapticsEnabled: enabled };
      }),
    setReadingMode: (readingMode) =>
      set((state) => {
        persist({ ...state, readingMode });
        return { readingMode };
      }),
  };
});
