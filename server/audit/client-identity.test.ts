import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditLog } from "./audit-log";
import { captureClientIdentity } from "./client-identity";

describe("ClientIdentityCapture", () => {
  test("prefers the first forwarded address and keeps the user agent", () => {
    expect(
      captureClientIdentity({
        headers: {
          "x-forwarded-for": "100.64.1.2, 10.0.0.1",
          "user-agent": "Mozilla/5.0 (iPhone)",
        },
        remoteAddress: "::ffff:127.0.0.1",
      }),
    ).toEqual({ ip: "100.64.1.2", device: "Mozilla/5.0 (iPhone)" });
  });

  test("falls back to the socket address and returns null for absent values", () => {
    expect(
      captureClientIdentity({ headers: { "user-agent": "UA" }, remoteAddress: "::ffff:127.0.0.1" }),
    ).toEqual({ ip: "::ffff:127.0.0.1", device: "UA" });
    expect(captureClientIdentity({})).toEqual({ ip: null, device: null });
  });

  test("caps device strings at 200 characters", () => {
    expect(
      captureClientIdentity({ headers: { "user-agent": "x".repeat(500) } }).device,
    ).toHaveLength(200);
    expect(
      captureClientIdentity({ headers: { "user-agent": "UA" }, deviceName: "y".repeat(500) })
        .device,
    ).toHaveLength(200);
  });

  test("a non-empty custom name takes precedence over an identical user agent", () => {
    const headers = {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    };
    const mac = captureClientIdentity({ headers, deviceName: "書房 Mac" });
    const ipad = captureClientIdentity({ headers, deviceName: "iPad" });

    expect(mac.device).toBe("書房 Mac");
    expect(ipad.device).toBe("iPad");
    expect(ipad.device).not.toBe(mac.device);
    expect(captureClientIdentity({ headers: { "user-agent": "UA" }, deviceName: "" }).device).toBe(
      "UA",
    );
    expect(
      captureClientIdentity({ headers: { "user-agent": "UA" }, deviceName: "   " }).device,
    ).toBe("UA");
    expect(captureClientIdentity({ deviceName: "iPad" }).device).toBe("iPad");
  });

  test("JSONL safely round-trips control characters in a device name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-mobile-identity-"));
    const path = join(dir, "audit.jsonl");
    const device = 'a\nb"c\\d';
    try {
      await createAuditLog({ path }).append({
        action: "prompt_send",
        paneId: "%1",
        ip: null,
        device: captureClientIdentity({ deviceName: device }).device,
        outcome: "dispatched",
      });
      const lines = readFileSync(path, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!).device).toBe(device);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
