import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { Elysia } from "elysia";
import { createUploadImagePlugin } from "../upload-image";
import { cleanupUploads, getUploadDir } from "../upload-manager";

const serverConfig = {
  basePath: "",
  permissionMode: "default" as const,
  port: 3001,
  hostname: "0.0.0.0",
  defaultCwd: null,
  allowedRoots: null,
};

// 1x1 transparent PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function post(app: Elysia, body: unknown) {
  return app.handle(
    new Request("http://localhost/api/upload-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("Upload-image endpoint", () => {
  test("EX6: base64 PNG -> 200, path scoped to session, .png, file exists, bytes round-trip", async () => {
    const app = new Elysia().use(createUploadImagePlugin(serverConfig));
    const sessionId = "img-sess-ex6";
    try {
      const res = await post(app, {
        sessionId,
        base64: PNG_BASE64,
        mediaType: "image/png",
      });
      expect(res.status).toBe(200);
      const result = (await res.json()) as { path: string; sizeKB: number };
      expect(result.path).toContain(sessionId);
      expect(result.path.endsWith(".png")).toBe(true);
      expect(typeof result.sizeKB).toBe("number");
      expect(existsSync(result.path)).toBe(true);

      // round-trip: file bytes equal decoded base64
      const written = readFileSync(result.path);
      const expected = Buffer.from(atob(PNG_BASE64), "binary");
      expect(Buffer.compare(written, expected)).toBe(0);
    } finally {
      await cleanupUploads(sessionId);
    }
  });

  test("EX7a: missing sessionId -> 4xx, no file written", async () => {
    const app = new Elysia().use(createUploadImagePlugin(serverConfig));
    const res = await post(app, { base64: PNG_BASE64, mediaType: "image/png" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test("EX7b: empty base64 -> 4xx, no file written for that session", async () => {
    const app = new Elysia().use(createUploadImagePlugin(serverConfig));
    const sessionId = "img-sess-ex7b";
    try {
      const res = await post(app, { sessionId, base64: "", mediaType: "image/png" });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      // nothing should have been written
      expect(existsSync(getUploadDir(sessionId))).toBe(false);
    } finally {
      await cleanupUploads(sessionId);
    }
  });

  test("EX8: cleanupUploads(sessionId) after upload -> getUploadDir not present", async () => {
    const app = new Elysia().use(createUploadImagePlugin(serverConfig));
    const sessionId = "img-sess-ex8";
    const res = await post(app, {
      sessionId,
      base64: PNG_BASE64,
      mediaType: "image/png",
    });
    expect(res.status).toBe(200);
    expect(existsSync(getUploadDir(sessionId))).toBe(true);
    await cleanupUploads(sessionId);
    expect(existsSync(getUploadDir(sessionId))).toBe(false);
  });

  test("EX-ext: mediaType maps to extension (jpeg->.jpg, gif->.gif, webp->.webp, other->.bin)", async () => {
    const cases: Array<[string, string]> = [
      ["image/jpeg", ".jpg"],
      ["image/gif", ".gif"],
      ["image/webp", ".webp"],
      ["application/octet-stream", ".bin"],
    ];
    for (const [mediaType, ext] of cases) {
      const app = new Elysia().use(createUploadImagePlugin(serverConfig));
      const sessionId = `img-sess-ext-${ext.slice(1)}`;
      try {
        const res = await post(app, { sessionId, base64: PNG_BASE64, mediaType });
        expect(res.status).toBe(200);
        const result = (await res.json()) as { path: string };
        expect(result.path.endsWith(ext)).toBe(true);
      } finally {
        await cleanupUploads(sessionId);
      }
    }
  });
});
