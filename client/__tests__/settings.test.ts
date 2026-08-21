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
      hapticsEnabled: false,
      readingMode: "conversation",
    });
    const stored = mockStorage.get("cc-mobile-settings");
    expect(stored).toBe(
      '{"defaultCwd":"/tmp","theme":"light","notificationsEnabled":false,"hapticsEnabled":false,"readingMode":"conversation"}',
    );
  });

  test("loadSettings returns defaults when key missing", () => {
    mockStorage.delete("cc-mobile-settings");
    const result = loadSettings();
    expect(result).toEqual({
      defaultCwd: "",
      theme: "dark",
      notificationsEnabled: false,
      hapticsEnabled: false,
      readingMode: "conversation",
    });
  });

  test("loadSettings returns defaults on invalid JSON", () => {
    mockStorage.set("cc-mobile-settings", "not json");
    const result = loadSettings();
    expect(result).toEqual({
      defaultCwd: "",
      theme: "dark",
      notificationsEnabled: false,
      hapticsEnabled: false,
      readingMode: "conversation",
    });
  });

  test("loadSettings returns saved values, ignoring keys it no longer carries", () => {
    // A bundle from before the agent-settings controls were removed wrote
    // model/effort/permissionMode/envVars here. They are read past, not
    // migrated: nothing consumes them any more.
    mockStorage.set(
      "cc-mobile-settings",
      '{"defaultCwd":"/workspace","theme":"claude","permissionMode":"default","model":"opus","envVars":{"A":"1"}}',
    );
    const result = loadSettings();
    expect(result).toEqual({
      defaultCwd: "/workspace",
      theme: "claude",
      notificationsEnabled: false,
      hapticsEnabled: false,
      readingMode: "conversation",
    });
  });
});

describe("ReadingModeToggle", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("T1: a fresh client with no stored setting defaults to conversation", () => {
    expect(loadSettings().readingMode).toBe("conversation");
  });

  test("T2: switching to Full is persisted through the same settings path", () => {
    saveSettings({
      defaultCwd: "",
      theme: "dark",
      notificationsEnabled: false,
      hapticsEnabled: false,
      readingMode: "full",
    });
    expect(loadSettings().readingMode).toBe("full");
  });
});
