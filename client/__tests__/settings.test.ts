import { describe, test, expect, beforeEach } from "bun:test";
import { saveSettings, loadSettings } from "../services/settings";

// Mock localStorage
const mockStorage = new Map<string, string>();
global.localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
  key: (index: number) => Array.from(mockStorage.keys())[index] ?? null,
  get length() {
    return mockStorage.size;
  },
};

describe("settings service", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("saveSettings writes to localStorage", () => {
    saveSettings({ defaultCwd: "/tmp", theme: "light" });
    const stored = mockStorage.get("cc-touch-settings");
    expect(stored).toBe('{"defaultCwd":"/tmp","theme":"light"}');
  });

  test("loadSettings returns defaults when key missing", () => {
    mockStorage.delete("cc-touch-settings");
    const result = loadSettings();
    expect(result).toEqual({ defaultCwd: "", theme: "dark" });
  });

  test("loadSettings returns defaults on invalid JSON", () => {
    mockStorage.set("cc-touch-settings", "not json");
    const result = loadSettings();
    expect(result).toEqual({ defaultCwd: "", theme: "dark" });
  });

  test("loadSettings returns saved values", () => {
    mockStorage.set("cc-touch-settings", '{"defaultCwd":"/workspace","theme":"claude"}');
    const result = loadSettings();
    expect(result).toEqual({ defaultCwd: "/workspace", theme: "claude" });
  });
});
