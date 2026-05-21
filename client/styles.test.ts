import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const clientDir = import.meta.dir;

describe("THEME_VARIABLES", () => {
  test("T9: No #808080 in styles.css (outside theme variable definitions)", () => {
    const stylesPath = join(clientDir, "styles.css");
    const content = readFileSync(stylesPath, "utf-8");

    // Extract everything after the theme definitions
    const afterThemeVars = content.split("/* Touch-friendly defaults */")[1] || "";

    expect(afterThemeVars).not.toContain("#808080");
  });

  test("T10: No #0066ff in styles.css (outside theme variable definitions)", () => {
    const stylesPath = join(clientDir, "styles.css");
    const content = readFileSync(stylesPath, "utf-8");

    // Extract everything after the theme definitions
    const afterThemeVars = content.split("/* Touch-friendly defaults */")[1] || "";

    expect(afterThemeVars).not.toContain("#0066ff");
  });
});
