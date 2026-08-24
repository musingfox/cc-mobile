import { create } from "zustand";
import { loadSettings, type ReadingMode, saveSettings, type Theme } from "../services/settings";

const DEVICE_NAME_KEY = "ccm:deviceName";
let nextDeviceId = Math.floor(Math.random() * 0x10000);

interface SettingsState {
  defaultCwd: string;
  theme: Theme;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
  readingMode: ReadingMode;
  deviceName: string;
  setDefaultCwd: (cwd: string) => void;
  setTheme: (theme: Theme) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setReadingMode: (mode: ReadingMode) => void;
  setDeviceName: (name: string) => void;
}

function defaultDeviceName(): string {
  const suffix = nextDeviceId.toString(16).padStart(4, "0");
  nextDeviceId = (nextDeviceId + 1) & 0xffff;
  return `device-${suffix}`;
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

export function createSettingsStore(storage: Storage = localStorage) {
  return create<SettingsState>((set) => {
    const initialSettings = loadSettings();
    let deviceName = storage.getItem(DEVICE_NAME_KEY)?.trim() ?? "";
    if (!deviceName) {
      deviceName = defaultDeviceName();
      storage.setItem(DEVICE_NAME_KEY, deviceName);
    }

    return {
      defaultCwd: initialSettings.defaultCwd,
      theme: initialSettings.theme,
      notificationsEnabled: initialSettings.notificationsEnabled,
      hapticsEnabled: initialSettings.hapticsEnabled,
      readingMode: initialSettings.readingMode,
      deviceName,
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
      setDeviceName: (name) =>
        set(() => {
          storage.setItem(DEVICE_NAME_KEY, name);
          return { deviceName: name };
        }),
    };
  });
}

export const useSettingsStore = createSettingsStore();
