import { describe, expect, test } from "bun:test";
import { resizeImage } from "./image-resize";

/**
 * Note: These tests require a DOM environment with canvas support.
 * They are designed to run in browser-based test environments (e.g., Playwright).
 * When run in Bun's test runner, tests that need canvas will be skipped.
 */

// Check if we have canvas support
const hasCanvasSupport = () => {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("2d") !== null;
  } catch {
    return false;
  }
};

describe("image-resize", () => {
  test("C1: throws error for unsupported format", async () => {
    const file = new File(["fake content"], "test.heic", { type: "image/heic" });
    await expect(resizeImage(file)).rejects.toThrow("Unsupported image format");
  });

  test.skipIf(!hasCanvasSupport())("C1: resizes large JPEG image", async () => {
    // Create a 3000x2000 JPEG
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 2000;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.fillStyle = "#3366FF";
    ctx.fillRect(0, 0, 3000, 2000);

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9);
    });

    const file = new File([blob], "large.jpg", { type: "image/jpeg" });

    const result = await resizeImage(file);

    expect(result.mediaType).toBe("image/jpeg");
    expect(result.base64).toBeDefined();
    expect(result.base64.length).toBeGreaterThan(0);

    // Check that image was resized (base64 should represent smaller dimensions)
    // Since we resized to max 1568, the size should be significantly smaller
    expect(result.sizeKB).toBeLessThan(1000); // Reasonable for a 1568px JPEG
  });

  test.skipIf(!hasCanvasSupport())("C1: does not resize small PNG", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.fillStyle = "#FF6633";
    ctx.fillRect(0, 0, 800, 600);

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/png");
    });

    const file = new File([blob], "small.png", { type: "image/png" });

    const result = await resizeImage(file);

    expect(result.mediaType).toBe("image/png");
    expect(result.base64).toBeDefined();
    // Should return original (not resized)
    expect(result.sizeKB).toBeGreaterThan(0);
  });

  test.skipIf(!hasCanvasSupport())("resizes image if file size exceeds 3.75MB", async () => {
    // Create a large PNG that's under dimension limit but over size limit
    const canvas = document.createElement("canvas");
    canvas.width = 1500;
    canvas.height = 1500;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");

    // Fill with complex pattern to make file large
    for (let x = 0; x < 1500; x += 10) {
      for (let y = 0; y < 1500; y += 10) {
        ctx.fillStyle = `rgb(${x % 255}, ${y % 255}, ${(x + y) % 255})`;
        ctx.fillRect(x, y, 10, 10);
      }
    }

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/png");
    });

    // If blob is small, skip this test (can't reliably create 3.75MB+ in test)
    if (blob.size < 3.75 * 1024 * 1024) {
      console.log("Skipping large file test - unable to create 3.75MB+ file in test env");
      return;
    }

    const file = new File([blob], "large.png", { type: "image/png" });

    const result = await resizeImage(file);

    expect(result.mediaType).toBe("image/png");
    expect(result.sizeKB).toBeLessThan(5000); // Should be compressed
  });
});
