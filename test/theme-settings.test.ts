import { describe, expect, test, beforeEach } from "bun:test";
import { loadSettings, saveSettings } from "../client/services/settings";

describe("Theme Type Settings", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  test("T1.4: saveSettings with ember theme persists correctly", () => {
    saveSettings({
      defaultCwd: "",
      theme: "ember",
      notificationsEnabled: false,
      hapticsEnabled: false,
      envVars: {},
      model: "claude-sonnet-4-6",
      effort: null,
      permissionMode: "default",
    });

    const loaded = loadSettings();
    expect(loaded.theme).toBe("ember");
  });

  test("T1.5: localStorage with ember theme loads correctly", () => {
    localStorage.setItem("cc-mobile-settings", JSON.stringify({ theme: "ember" }));
    const loaded = loadSettings();
    expect(loaded.theme).toBe("ember");
  });

  test("T1.6: invalid theme falls back to dark", () => {
    localStorage.setItem("cc-mobile-settings", JSON.stringify({ theme: "garbage" }));
    const loaded = loadSettings();
    expect(loaded.theme).toBe("dark");
  });

  test("T1.7: existing themes still work (dark)", () => {
    saveSettings({
      defaultCwd: "",
      theme: "dark",
      notificationsEnabled: false,
      hapticsEnabled: false,
      envVars: {},
      model: "claude-sonnet-4-6",
      effort: null,
      permissionMode: "default",
    });
    const loaded = loadSettings();
    expect(loaded.theme).toBe("dark");
  });

  test("T1.7b: existing themes still work (light)", () => {
    saveSettings({
      defaultCwd: "",
      theme: "light",
      notificationsEnabled: false,
      hapticsEnabled: false,
      envVars: {},
      model: "claude-sonnet-4-6",
      effort: null,
      permissionMode: "default",
    });
    const loaded = loadSettings();
    expect(loaded.theme).toBe("light");
  });

  test("T1.7c: existing themes still work (claude)", () => {
    saveSettings({
      defaultCwd: "",
      theme: "claude",
      notificationsEnabled: false,
      hapticsEnabled: false,
      envVars: {},
      model: "claude-sonnet-4-6",
      effort: null,
      permissionMode: "default",
    });
    const loaded = loadSettings();
    expect(loaded.theme).toBe("claude");
  });
});
