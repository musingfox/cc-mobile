import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSettings, saveSettings } from "../client/services/settings";
import { ServerMessage } from "../server/protocol";
import type { Capabilities } from "../server/capabilities-cache";

describe("Contract Validation - T1 Theme Tokens & Type", () => {
  test("Contract: ThemeTokens - all required CSS vars defined", () => {
    const cssPath = join(import.meta.dir, "../client/styles.css");
    const css = readFileSync(cssPath, "utf-8");
    const emberTheme = css.match(/\.theme-ember\s*\{[\s\S]*?\n\}/)?.[0];

    expect(emberTheme).toBeDefined();
    expect(emberTheme).toContain("--bg-primary: #13110d");
    expect(emberTheme).toContain("--bg-secondary: #1d1a14");
    expect(emberTheme).toContain("--bg-tertiary: #24201a");
    expect(emberTheme).toContain("--text-primary: #efe7d6");
    expect(emberTheme).toContain("--text-secondary: #8e8677");
    expect(emberTheme).toContain("--accent-primary: #f5c76a");
    expect(emberTheme).toContain("--accent-warning: #f5c76a");
    expect(emberTheme).toContain("--accent-success: #b8cfa8");
    expect(emberTheme).toContain("--ember-amber-deep: #d89a3c");
    expect(emberTheme).toContain("--ember-sage: #b8cfa8");
    expect(emberTheme).toContain("--ember-rose: #e8a496");
    expect(emberTheme).toContain("--ember-faint: #5a5346");
    expect(emberTheme).toContain("--font-mono: \"IBM Plex Mono\"");
    expect(emberTheme).toContain("--font-sans: \"IBM Plex Sans\"");
  });

  test("Contract: ThemeType - ember theme persists and loads", () => {
    localStorage.clear();
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

  test("Contract: ThemeType - invalid theme falls back to dark", () => {
    localStorage.clear();
    localStorage.setItem("cc-mobile-settings", JSON.stringify({ theme: "invalid" }));
    const loaded = loadSettings();
    expect(loaded.theme).toBe("dark");
  });
});

describe("Contract Validation - T4 Capabilities Protocol Extension", () => {
  test("Contract: CapabilitiesSchema - new format with objects parses", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      agents: [{ name: "coder", description: "Code agent" }],
      commands: [{ name: "/help", description: "Help command" }],
      model: "test-model",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents).toEqual([{ name: "coder", description: "Code agent" }]);
      expect(result.data.commands).toEqual([{ name: "/help", description: "Help command" }]);
    }
  });

  test("Contract: CapabilitiesSchema - old format with strings transforms", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      agents: ["coder", "explorer"],
      commands: ["/help", "/commit"],
      model: "test-model",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents).toEqual([{ name: "coder" }, { name: "explorer" }]);
      expect(result.data.commands).toEqual([{ name: "/help" }, { name: "/commit" }]);
    }
  });

  test("Contract: CapabilitiesSchema - malformed data throws", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      agents: [123, 456],
      commands: ["/help"],
      model: "test-model",
    });

    expect(result.success).toBe(false);
  });

  test("Contract: CapabilitiesSchema - partial object (name only) succeeds", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      agents: [{ name: "minimal" }],
      commands: [{ name: "/test" }],
      model: "test-model",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0].description).toBeUndefined();
      expect(result.data.commands[0].description).toBeUndefined();
    }
  });
});
