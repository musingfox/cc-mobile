import { beforeEach, describe, expect, test } from "bun:test";
import { loadSettings, saveSettings } from "../services/settings";
import { useSettingsStore } from "../stores/settings-store";
import { validateEnvKey } from "../utils/env-validation";

// Mock localStorage
const mockStorage = new Map<string, string>();
Object.defineProperty(global, "localStorage", {
  value: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, value: string) => mockStorage.set(key, value),
    removeItem: (key: string) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
    key: (index: number) => Array.from(mockStorage.keys())[index] ?? null,
    get length() {
      return mockStorage.size;
    },
  },
  writable: true,
  configurable: true,
});

describe("Settings persistence", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("1: saveSettings with envVars returns envVars on loadSettings", () => {
    saveSettings({
      defaultCwd: "",
      theme: "dark",
      notificationsEnabled: false,
      hapticsEnabled: false,
      envVars: { A: "1" },
      model: "claude-sonnet-4-6",
      effort: null,
      permissionMode: "default",
    });
    const result = loadSettings();
    expect(result.envVars).toEqual({ A: "1" });
  });

  test("2: loadSettings with missing envVars field returns empty object", () => {
    mockStorage.set(
      "cc-mobile-settings",
      '{"defaultCwd":"","theme":"dark","notificationsEnabled":false,"hapticsEnabled":false}',
    );
    const result = loadSettings();
    expect(result.envVars).toEqual({});
  });

  test("3: loadSettings with corrupted envVars returns empty object", () => {
    mockStorage.set(
      "cc-mobile-settings",
      '{"defaultCwd":"","theme":"dark","notificationsEnabled":false,"hapticsEnabled":false,"envVars":["invalid"]}',
    );
    const result = loadSettings();
    expect(result.envVars).toEqual({});
  });
});

describe("Settings store", () => {
  beforeEach(() => {
    mockStorage.clear();
    // Reset store to default state
    useSettingsStore.getState().setEnvVars({});
  });

  test("4: setEnvVar adds to envVars", () => {
    useSettingsStore.getState().setEnvVar("API_KEY", "test");
    expect(useSettingsStore.getState().envVars).toEqual({ API_KEY: "test" });
  });

  test("5: removeEnvVar removes from envVars", () => {
    useSettingsStore.getState().setEnvVar("API_KEY", "test");
    useSettingsStore.getState().removeEnvVar("API_KEY");
    expect(useSettingsStore.getState().envVars).toEqual({});
  });

  test("6: setEnvVar with empty key is no-op", () => {
    const initialEnvVars = { ...useSettingsStore.getState().envVars };
    useSettingsStore.getState().setEnvVar("", "val");
    expect(useSettingsStore.getState().envVars).toEqual(initialEnvVars);
  });

  test("7: setEnvVar with whitespace in key is no-op", () => {
    const initialEnvVars = { ...useSettingsStore.getState().envVars };
    useSettingsStore.getState().setEnvVar("MY KEY", "val");
    expect(useSettingsStore.getState().envVars).toEqual(initialEnvVars);
  });

  test("8: setEnvVars replaces envVars", () => {
    useSettingsStore.getState().setEnvVars({ A: "1", B: "2" });
    expect(useSettingsStore.getState().envVars).toEqual({ A: "1", B: "2" });
  });
});

describe("Validation", () => {
  test("9: validateEnvKey with valid key returns null", () => {
    expect(validateEnvKey("NODE_ENV")).toBe(null);
  });

  test("10: validateEnvKey with empty string returns error", () => {
    expect(validateEnvKey("")).toBe("Key cannot be empty");
  });

  test("11: validateEnvKey with whitespace returns error", () => {
    expect(validateEnvKey("MY KEY")).toBe("Key cannot contain whitespace");
  });
});
