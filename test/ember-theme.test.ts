import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Ember Theme Tokens", () => {
  test("T1.1: styles.css contains theme-ember with --bg-primary: #13110d", () => {
    const cssPath = join(import.meta.dir, "../client/styles.css");
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain(".theme-ember");
    expect(css).toContain("--bg-primary: #13110d");
  });

  test("T1.2: styles.css contains theme-ember with --accent-primary: #f5c76a", () => {
    const cssPath = join(import.meta.dir, "../client/styles.css");
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("--accent-primary: #f5c76a");
  });

  test("T1.3: styles.css contains theme-ember with IBM Plex Mono font", () => {
    const cssPath = join(import.meta.dir, "../client/styles.css");
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("--font-mono: \"IBM Plex Mono\"");
  });

  test("T1.1-extended: theme-ember defines all required Ember-specific tokens", () => {
    const cssPath = join(import.meta.dir, "../client/styles.css");
    const css = readFileSync(cssPath, "utf-8");
    const emberSection = css.match(/\.theme-ember\s*\{[\s\S]*?\n\}/)?.[0];
    expect(emberSection).toBeDefined();
    expect(emberSection).toContain("--ember-amber-deep: #d89a3c");
    expect(emberSection).toContain("--ember-sage: #b8cfa8");
    expect(emberSection).toContain("--ember-rose: #e8a496");
    expect(emberSection).toContain("--ember-faint: #5a5346");
    expect(emberSection).toContain("--ember-hair: rgba(245, 199, 106, 0.12)");
    expect(emberSection).toContain("--ember-hair-neutral: rgba(255, 255, 255, 0.06)");
  });
});
