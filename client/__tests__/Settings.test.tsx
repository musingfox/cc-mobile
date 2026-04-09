import { describe, expect, test } from "bun:test";
import Settings from "../components/Settings";

// Extract PERMISSION_MODES for testing by importing and accessing the module
// Since PERMISSION_MODES is a const inside Settings.tsx, we'll test its behavior indirectly
// through the rendered component. For direct testing, we need to export it or test the contract
// through the UI behavior.

describe("Settings PERMISSION_MODES contract", () => {
  test("C1.1: PERMISSION_MODES should have exactly 6 modes", () => {
    // We need to access PERMISSION_MODES. Since it's not exported, we'll use a test helper.
    // For this test, we'll create a separate module or test the constant directly.

    // Extract the constant from Settings component source
    const settingsSource = Bun.file(
      "/Users/nickhuang/workspace/cc-mobile/client/components/Settings.tsx",
    ).text();
    const constantMatch = settingsSource.then((source) => {
      const match = source.match(/const PERMISSION_MODES = \[([\s\S]*?)\] as const;/);
      if (!match) throw new Error("PERMISSION_MODES not found");

      // Count the number of objects in the array
      const objectCount = (match[1].match(/\{/g) || []).length;
      return objectCount;
    });

    return constantMatch.then((count) => {
      expect(count).toBe(6);
    });
  });

  test("C1.2: PERMISSION_MODES should contain all 6 expected mode IDs", () => {
    const settingsSource = Bun.file(
      "/Users/nickhuang/workspace/cc-mobile/client/components/Settings.tsx",
    ).text();

    return settingsSource.then((source) => {
      const expectedModes = [
        "default",
        "acceptEdits",
        "auto",
        "plan",
        "dontAsk",
        "bypassPermissions",
      ];

      for (const mode of expectedModes) {
        expect(source).toContain(`id: "${mode}"`);
      }
    });
  });

  test("C1.3: Every mode should have non-empty label and description", () => {
    const settingsSource = Bun.file(
      "/Users/nickhuang/workspace/cc-mobile/client/components/Settings.tsx",
    ).text();

    return settingsSource.then((source) => {
      const match = source.match(/const PERMISSION_MODES = \[([\s\S]*?)\] as const;/);
      if (!match) throw new Error("PERMISSION_MODES not found");

      const modesContent = match[1];

      // Extract all label and description values
      const labels = modesContent.match(/label: "([^"]+)"/g) || [];
      const descriptions = modesContent.match(/description: "([^"]+)"/g) || [];

      expect(labels.length).toBe(6);
      expect(descriptions.length).toBe(6);

      // Check that no label or description is empty
      for (const label of labels) {
        const value = label.match(/label: "([^"]+)"/)?.[1];
        expect(value).toBeTruthy();
        expect(value!.length).toBeGreaterThan(0);
      }

      for (const desc of descriptions) {
        const value = desc.match(/description: "([^"]+)"/)?.[1];
        expect(value).toBeTruthy();
        expect(value!.length).toBeGreaterThan(0);
      }
    });
  });

  test("C1.4: First mode should be 'default' (safest)", () => {
    const settingsSource = Bun.file(
      "/Users/nickhuang/workspace/cc-mobile/client/components/Settings.tsx",
    ).text();

    return settingsSource.then((source) => {
      const match = source.match(/const PERMISSION_MODES = \[\s*\{[\s\S]*?id: "([^"]+)"/);
      if (!match) throw new Error("First mode ID not found");

      expect(match[1]).toBe("default");
    });
  });
});
