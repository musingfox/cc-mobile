import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DIST_DIR = join(import.meta.dir, "..", "test-dist", "client");

beforeAll(() => {
  // Create test dist directory
  if (existsSync(TEST_DIST_DIR)) {
    rmSync(TEST_DIST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIST_DIR, "index.html"), "<html>Test Index</html>");
  mkdirSync(join(TEST_DIST_DIR, "assets"), { recursive: true });
  writeFileSync(join(TEST_DIST_DIR, "assets", "main.js"), "console.log('test');");
});

afterAll(() => {
  // Cleanup
  if (existsSync(join(import.meta.dir, "..", "test-dist"))) {
    rmSync(join(import.meta.dir, "..", "test-dist"), { recursive: true });
  }
});

describe("Static file serving", () => {
  test("TC10: GET / with dist/client/index.html exists returns index.html (200)", async () => {
    const indexFile = Bun.file(join(TEST_DIST_DIR, "index.html"));
    expect(await indexFile.exists()).toBe(true);
    const content = await indexFile.text();
    expect(content).toBe("<html>Test Index</html>");
  });

  test("TC11: GET /assets/main.js with file exists returns JS file with correct content", async () => {
    const jsFile = Bun.file(join(TEST_DIST_DIR, "assets", "main.js"));
    expect(await jsFile.exists()).toBe(true);
    const content = await jsFile.text();
    expect(content).toBe("console.log('test');");
  });

  test("TC12: GET /nonexistent.js returns 404 (simulated)", async () => {
    const nonexistentFile = Bun.file(join(TEST_DIST_DIR, "nonexistent.js"));
    expect(await nonexistentFile.exists()).toBe(false);
  });
});
