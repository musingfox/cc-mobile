import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("sw.js skipWaiting behavior", () => {
  const swPath = join(__dirname, "../public/sw.js");
  const swContent = readFileSync(swPath, "utf-8");

  // TC-SW1: sw.js does NOT contain self.skipWaiting() in install handler
  test("TC-SW1: install handler does not call self.skipWaiting()", () => {
    // Find the install event handler
    const installHandlerMatch = swContent.match(
      /self\.addEventListener\("install",\s*\(event\)\s*=>\s*{[\s\S]*?}\);/,
    );

    expect(installHandlerMatch).not.toBeNull();

    if (installHandlerMatch) {
      const installHandler = installHandlerMatch[0];
      // Should NOT contain self.skipWaiting() in the install handler
      expect(installHandler).not.toContain("self.skipWaiting()");
    }
  });

  // TC-SW2: sw.js contains message event listener with SKIP_WAITING check
  test("TC-SW2: message event listener handles SKIP_WAITING", () => {
    // Should have a message event listener
    expect(swContent).toContain('addEventListener("message"');

    // Should check for SKIP_WAITING type
    expect(swContent).toContain('type === "SKIP_WAITING"');

    // Should call self.skipWaiting() in the message handler
    const messageHandlerMatch = swContent.match(
      /self\.addEventListener\("message",\s*\(event\)\s*=>\s*{[\s\S]*?}\);/,
    );

    expect(messageHandlerMatch).not.toBeNull();

    if (messageHandlerMatch) {
      const messageHandler = messageHandlerMatch[0];
      expect(messageHandler).toContain("self.skipWaiting()");
    }
  });

  // Additional: verify overall structure
  test("sw.js has proper event handler structure", () => {
    // Should have install, activate, and message handlers
    expect(swContent).toContain('addEventListener("install"');
    expect(swContent).toContain('addEventListener("activate"');
    expect(swContent).toContain('addEventListener("message"');
    expect(swContent).toContain('addEventListener("fetch"');
  });
});
