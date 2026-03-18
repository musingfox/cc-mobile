import { create } from "zustand";
import { loadSettings, saveSettings, type Theme } from "../services/settings";

interface SettingsState {
  defaultCwd: string;
  theme: Theme;
  notificationsEnabled: boolean;
  voiceInputEnabled: boolean;
  hapticsEnabled: boolean;
  envVars: Record<string, string>;
  setDefaultCwd: (cwd: string) => void;
  setTheme: (theme: Theme) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setVoiceInputEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setEnvVar: (key: string, value: string) => void;
  removeEnvVar: (key: string) => void;
  setEnvVars: (envVars: Record<string, string>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => {
  const initialSettings = loadSettings();

  return {
    defaultCwd: initialSettings.defaultCwd,
    theme: initialSettings.theme,
    notificationsEnabled: initialSettings.notificationsEnabled,
    voiceInputEnabled: initialSettings.voiceInputEnabled,
    hapticsEnabled: initialSettings.hapticsEnabled,
    envVars: initialSettings.envVars,
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
    setEnvVar: (key, value) =>
      set((state) => {
        if (key === "" || /\s/.test(key)) {
          return state;
        }
        const envVars = { ...state.envVars, [key]: value };
        const newSettings = { ...state, envVars };
        saveSettings(newSettings);
        return { envVars };
      }),
    removeEnvVar: (key) =>
      set((state) => {
        const envVars = { ...state.envVars };
        delete envVars[key];
        const newSettings = { ...state, envVars };
        saveSettings(newSettings);
        return { envVars };
      }),
    setEnvVars: (envVars) =>
      set((state) => {
        const newSettings = { ...state, envVars };
        saveSettings(newSettings);
        return { envVars };
      }),
  };
});
