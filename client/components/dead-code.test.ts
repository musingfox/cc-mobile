import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const clientDir = join(import.meta.dir, "..");

describe("DEAD_CODE", () => {
  test("T6: ToolStatusBar.tsx does not exist", () => {
    const path = join(import.meta.dir, "ToolStatusBar.tsx");
    expect(existsSync(path)).toBe(false);
  });

  test("T7: No .command-manager in styles.css", () => {
    const stylesPath = join(clientDir, "styles.css");
    const content = readFileSync(stylesPath, "utf-8");

    // Should not contain the CSS class definition
    expect(content).not.toContain(".command-manager");
  });

  test("T8: No .tool-status-bar in styles.css (as a CSS class definition)", () => {
    const stylesPath = join(clientDir, "styles.css");
    const content = readFileSync(stylesPath, "utf-8");

    // Should not contain the CSS class definition
    expect(content).not.toContain(".tool-status-bar");
  });
});
