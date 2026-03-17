import { create } from "zustand";
import { loadSettings, saveSettings, type Theme } from "../services/settings";

interface SettingsState {
  defaultCwd: string;
  theme: Theme;
  notificationsEnabled: boolean;
  voiceInputEnabled: boolean;
  hapticsEnabled: boolean;
  setDefaultCwd: (cwd: string) => void;
  setTheme: (theme: Theme) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setVoiceInputEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => {
  const initialSettings = loadSettings();

  return {
    defaultCwd: initialSettings.defaultCwd,
    theme: initialSettings.theme,
    notificationsEnabled: initialSettings.notificationsEnabled,
    voiceInputEnabled: initialSettings.voiceInputEnabled,
    hapticsEnabled: initialSettings.hapticsEnabled,
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
    setNotificationsEnabled: (enabled) =>
      set((state) => {
        const newSettings = { ...state, notificationsEnabled: enabled };
        saveSettings(newSettings);
        return { notificationsEnabled: enabled };
      }),
    setVoiceInputEnabled: (enabled) =>
      set((state) => {
        const newSettings = { ...state, voiceInputEnabled: enabled };
        saveSettings(newSettings);
        return { voiceInputEnabled: enabled };
      }),
    setHapticsEnabled: (enabled) =>
      set((state) => {
        const newSettings = { ...state, hapticsEnabled: enabled };
        saveSettings(newSettings);
        return { hapticsEnabled: enabled };
      }),
  };
});
