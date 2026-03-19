import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CLIENT_ROOT = join(import.meta.dir, "..");
const PUBLIC_DIR = join(CLIENT_ROOT, "public");
const ICONS_DIR = join(PUBLIC_DIR, "icons");

describe("PWA Manifest", () => {
  test("TC1: manifest.json is valid JSON with required fields", () => {
    const manifestPath = join(PUBLIC_DIR, "manifest.json");
    const manifestContent = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent);

    expect(manifest.name).toBeDefined();
    expect(manifest.short_name).toBeDefined();
    expect(manifest.start_url).toBeDefined();
    expect(manifest.display).toBeDefined();
    expect(manifest.icons).toBeDefined();
    expect(Array.isArray(manifest.icons)).toBe(true);
  });

  test("TC2: manifest.json theme_color matches dark theme accent", () => {
    const manifestPath = join(PUBLIC_DIR, "manifest.json");
    const manifestContent = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent);

    expect(manifest.theme_color).toBe("#0066ff");
  });

  test("TC3: manifest.json background_color matches dark theme bg", () => {
    const manifestPath = join(PUBLIC_DIR, "manifest.json");
    const manifestContent = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent);

    expect(manifest.background_color).toBe("#1a1a2e");
  });

  test("TC4: manifest.json has minimum required icons", () => {
    const manifestPath = join(PUBLIC_DIR, "manifest.json");
    const manifestContent = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent);

    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });
});

describe("HTML Meta Tags", () => {
  test("TC5: index.html contains manifest link", () => {
    const htmlPath = join(CLIENT_ROOT, "index.html");
    const htmlContent = readFileSync(htmlPath, "utf-8");

    expect(htmlContent).toContain('rel="manifest"');
  });

  test("TC6: index.html contains theme-color meta", () => {
    const htmlPath = join(CLIENT_ROOT, "index.html");
    const htmlContent = readFileSync(htmlPath, "utf-8");

    expect(htmlContent).toContain('name="theme-color"');
  });

  test("TC7: index.html contains apple-mobile-web-app-capable", () => {
    const htmlPath = join(CLIENT_ROOT, "index.html");
    const htmlContent = readFileSync(htmlPath, "utf-8");

    expect(htmlContent).toContain('name="apple-mobile-web-app-capable"');
  });

  test("TC8: index.html contains apple-touch-icon link", () => {
    const htmlPath = join(CLIENT_ROOT, "index.html");
    const htmlContent = readFileSync(htmlPath, "utf-8");

    expect(htmlContent).toContain('rel="apple-touch-icon"');
  });
});

describe("Service Worker", () => {
  test("TC9: sw.js file exists in public/", () => {
    const swPath = join(PUBLIC_DIR, "sw.js");
    expect(existsSync(swPath)).toBe(true);
  });

  test("TC10: sw.js contains install event listener", () => {
    const swPath = join(PUBLIC_DIR, "sw.js");
    const swContent = readFileSync(swPath, "utf-8");

    expect(swContent).toContain("install");
  });

  test("TC11: sw.js skips WebSocket requests", () => {
    const swPath = join(PUBLIC_DIR, "sw.js");
    const swContent = readFileSync(swPath, "utf-8");

    expect(swContent).toContain("/ws");
  });
});

describe("Icon Files", () => {
  test("TC12: All required icon files exist", () => {
    const icon192 = join(ICONS_DIR, "icon-192.png");
    const icon512 = join(ICONS_DIR, "icon-512.png");
    const appleTouchIcon = join(ICONS_DIR, "apple-touch-icon.png");

    expect(existsSync(icon192)).toBe(true);
    expect(existsSync(icon512)).toBe(true);
    expect(existsSync(appleTouchIcon)).toBe(true);
  });
});

describe("Notification Service", () => {
  test("TC15: notification.ts uses tag for deduplication", () => {
    const notifPath = join(CLIENT_ROOT, "services", "notification.ts");
    const notifContent = readFileSync(notifPath, "utf-8");

    expect(notifContent).toContain("tag");
    expect(notifContent).toContain("renotify");
  });

  test("TC16: notification accepts sessionId for per-session dedup", () => {
    const notifPath = join(CLIENT_ROOT, "services", "notification.ts");
    const notifContent = readFileSync(notifPath, "utf-8");

    expect(notifContent).toContain("sessionId");
    expect(notifContent).toContain("cc-mobile-permission-");
  });
});

describe("SW Notification Click", () => {
  test("TC17: sw.js contains notificationclick handler", () => {
    const swPath = join(PUBLIC_DIR, "sw.js");
    const swContent = readFileSync(swPath, "utf-8");

    expect(swContent).toContain("notificationclick");
    expect(swContent).toContain("client.focus");
  });

  test("TC18: sw.js notificationclick opens new window as fallback", () => {
    const swPath = join(PUBLIC_DIR, "sw.js");
    const swContent = readFileSync(swPath, "utf-8");

    expect(swContent).toContain("openWindow");
  });
});

describe("Build Integration", () => {
  test("TC13: Build succeeds with PWA files", async () => {
    // Run build
    const buildProcess = Bun.spawn(["bun", "run", "build"], {
      cwd: join(CLIENT_ROOT, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await buildProcess.exited;
    expect(exitCode).toBe(0);

    // Check that PWA files are copied to dist
    const distClientDir = join(CLIENT_ROOT, "..", "dist", "client");
    const distManifest = join(distClientDir, "manifest.json");
    const distSw = join(distClientDir, "sw.js");

    expect(existsSync(distManifest)).toBe(true);
    expect(existsSync(distSw)).toBe(true);
  }, 30_000);
});

describe("Dynamic Theme Color", () => {
  test("TC14: App.tsx contains theme-color meta tag update logic", () => {
    const appPath = join(CLIENT_ROOT, "App.tsx");
    const appContent = readFileSync(appPath, "utf-8");

    expect(appContent).toContain("theme-color");
  });
});
