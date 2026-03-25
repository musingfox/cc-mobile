import { create } from "zustand";
import { loadSettings, saveSettings, type Theme } from "../services/settings";

interface SettingsState {
  defaultCwd: string;
  theme: Theme;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
  envVars: Record<string, string>;
  model: string;
  effort: string | null;
  permissionMode: string;
  setDefaultCwd: (cwd: string) => void;
  setTheme: (theme: Theme) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setEnvVar: (key: string, value: string) => void;
  removeEnvVar: (key: string) => void;
  setEnvVars: (envVars: Record<string, string>) => void;
  setModel: (model: string) => void;
  setEffort: (effort: string | null) => void;
  setPermissionMode: (mode: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => {
  const initialSettings = loadSettings();

  return {
    defaultCwd: initialSettings.defaultCwd,
    theme: initialSettings.theme,
    notificationsEnabled: initialSettings.notificationsEnabled,
    hapticsEnabled: initialSettings.hapticsEnabled,
    envVars: initialSettings.envVars,
    model: initialSettings.model,
    effort: initialSettings.effort,
    permissionMode: initialSettings.permissionMode,
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
    setModel: (model) =>
      set((state) => {
        const newSettings = { ...state, model };
        saveSettings(newSettings);
        return { model };
      }),
    setEffort: (effort) =>
      set((state) => {
        const newSettings = { ...state, effort };
        saveSettings(newSettings);
        return { effort };
      }),
    setPermissionMode: (permissionMode) =>
      set((state) => {
        const newSettings = { ...state, permissionMode };
        saveSettings(newSettings);
        return { permissionMode };
      }),
  };
});
