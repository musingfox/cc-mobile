import { beforeEach, describe, expect, test } from "bun:test";
import { loadSettings, saveSettings } from "../services/settings";

// Mock localStorage (use defineProperty since happy-dom makes it readonly)
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

describe("settings service", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("saveSettings writes to localStorage", () => {
    saveSettings({
      defaultCwd: "/tmp",
      theme: "light",
      notificationsEnabled: false,
      voiceInputEnabled: false,
      hapticsEnabled: false,
    });
    const stored = mockStorage.get("cc-mobile-settings");
    expect(stored).toBe(
      '{"defaultCwd":"/tmp","theme":"light","notificationsEnabled":false,"voiceInputEnabled":false,"hapticsEnabled":false}',
    );
  });

  test("loadSettings returns defaults when key missing", () => {
    mockStorage.delete("cc-mobile-settings");
    const result = loadSettings();
    expect(result).toEqual({
      defaultCwd: "",
      theme: "dark",
      notificationsEnabled: false,
      voiceInputEnabled: false,
      hapticsEnabled: false,
    });
  });

  test("loadSettings returns defaults on invalid JSON", () => {
    mockStorage.set("cc-mobile-settings", "not json");
    const result = loadSettings();
    expect(result).toEqual({
      defaultCwd: "",
      theme: "dark",
      notificationsEnabled: false,
      voiceInputEnabled: false,
      hapticsEnabled: false,
    });
  });

  test("loadSettings returns saved values", () => {
    mockStorage.set("cc-mobile-settings", '{"defaultCwd":"/workspace","theme":"claude"}');
    const result = loadSettings();
    expect(result).toEqual({
      defaultCwd: "/workspace",
      theme: "claude",
      notificationsEnabled: false,
      voiceInputEnabled: false,
      hapticsEnabled: false,
    });
  });
});
