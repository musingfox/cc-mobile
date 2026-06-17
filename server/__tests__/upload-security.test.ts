// upload-security.test.ts — committed security fixture (turn 3)
//
// Behavioral assertions (not grep) that cover:
//   - Path-traversal sessionId rejected by both upload endpoints (4xx, no canary)
//   - safeSessionDir rejection table
//   - Legal sessionId round-trip (200, path under uploadsRoot)
//   - Bad base64 → 400, no leftover dir
//   - Oversize base64 → 413, no leftover dir
//
// Hermetic: random sessionIds and canary suffixes; afterEach/finally cleanup.
// Pattern: new Elysia().use(plugin) + app.handle(new Request(...))

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Elysia } from "elysia";
import { createUploadPlugin } from "../upload";
import { createUploadImagePlugin } from "../upload-image";
import { getUploadDir, safeSessionDir } from "../upload-manager";

const serverConfig = {
  basePath: "",
  permissionMode: "default" as const,
  port: 3001,
  hostname: "0.0.0.0",
  defaultCwd: null,
  allowedRoots: null,
};

const uploadsRoot = join(homedir(), ".cache", "cc-mobile", "uploads");

// 1×1 transparent PNG (valid base64, len % 4 === 0)
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const toClean = new Set<string>();

afterEach(() => {
  for (const p of toClean) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  toClean.clear();
});

function postJson(app: Elysia, body: unknown) {
  return app.handle(
    new Request("http://localhost/api/upload-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// ---- Path-traversal: /api/upload (multipart) ----------------------------------------

describe("Security: traversal sessionId — /api/upload (multipart)", () => {
  test("traversal sessionId -> 4xx, canary not written outside uploads root", async () => {
    const rand = crypto.randomUUID();
    const canaryDir = `/tmp/cc-sec-${rand}`;
    toClean.add(canaryDir);
    const sessionId = `../../../../tmp/cc-sec-${rand}`;

    try {
      const app = new Elysia().use(createUploadPlugin(serverConfig));
      const file = new File(["x".repeat(64)], "doc.pdf", {
        type: "application/pdf",
      });
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("file", file);

      const res = await app.handle(
        new Request("http://localhost/api/upload", {
          method: "POST",
          body: formData,
        }),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
      expect(existsSync(canaryDir)).toBe(false);
    } finally {
      rmSync(canaryDir, { recursive: true, force: true });
    }
  });
});

// ---- Path-traversal: /api/upload-image (JSON) ---------------------------------------

describe("Security: traversal sessionId — /api/upload-image (JSON)", () => {
  test("traversal sessionId -> 4xx, canary not written outside uploads root", async () => {
    const rand = crypto.randomUUID();
    const canaryDir = `/tmp/cc-sec-img-${rand}`;
    toClean.add(canaryDir);
    const sessionId = `../../../../tmp/cc-sec-img-${rand}`;

    try {
      const app = new Elysia().use(createUploadImagePlugin(serverConfig));
      const res = await postJson(app, {
        sessionId,
        base64: PNG_BASE64,
        mediaType: "image/png",
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
      expect(existsSync(canaryDir)).toBe(false);
    } finally {
      rmSync(canaryDir, { recursive: true, force: true });
    }
  });
});

// ---- safeSessionDir rejection table -------------------------------------------------

describe("Security: safeSessionDir rejection table", () => {
  const rejected = [
    "../foo",
    "a/b",
    "..",
    ".",
    "",
    "a/../b",
    "foo/",
    ".hidden",
    "a\\b", // backslash
    "a\0b", // embedded NUL
  ];

  for (const bad of rejected) {
    test(`safeSessionDir(${JSON.stringify(bad)}) throws`, () => {
      let threw = false;
      try {
        safeSessionDir(bad);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  }
});

// ---- Legal sessionId round-trip (no regression) -------------------------------------

describe("Security: legal sessionId — no regression", () => {
  test("valid sessionId -> 200, returned path is under uploadsRoot", async () => {
    const sessionId = `sec-ok-${crypto.randomUUID()}`;
    toClean.add(getUploadDir(sessionId));

    try {
      const app = new Elysia().use(createUploadImagePlugin(serverConfig));
      const res = await postJson(app, {
        sessionId,
        base64: PNG_BASE64,
        mediaType: "image/png",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.path).toBe("string");
      const rootPrefix = resolve(uploadsRoot) + sep;
      expect(resolve(body.path).startsWith(rootPrefix)).toBe(true);
    } finally {
      rmSync(getUploadDir(sessionId), { recursive: true, force: true });
    }
  });
});

// ---- Bad base64 → 400, no leftover dir ----------------------------------------------

describe("Security: bad base64 input hardening", () => {
  test("base64 with length not a multiple of 4 ('abc') -> 400, no session dir", async () => {
    const sessionId = `sec-b64-${crypto.randomUUID()}`;
    toClean.add(getUploadDir(sessionId));

    try {
      const app = new Elysia().use(createUploadImagePlugin(serverConfig));
      const res = await postJson(app, {
        sessionId,
        base64: "abc",
        mediaType: "image/png",
      });

      expect(res.status).toBe(400);
      expect(existsSync(getUploadDir(sessionId))).toBe(false);
    } finally {
      rmSync(getUploadDir(sessionId), { recursive: true, force: true });
    }
  });

  test("invalid base64 characters -> 4xx, no session dir", async () => {
    const sessionId = `sec-inv-${crypto.randomUUID()}`;
    toClean.add(getUploadDir(sessionId));

    try {
      const app = new Elysia().use(createUploadImagePlugin(serverConfig));
      const res = await postJson(app, {
        sessionId,
        base64: "!!!not-base64!!!",
        mediaType: "image/png",
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
      expect(existsSync(getUploadDir(sessionId))).toBe(false);
    } finally {
      rmSync(getUploadDir(sessionId), { recursive: true, force: true });
    }
  });
});

// ---- Oversize → 413, no leftover dir ------------------------------------------------

describe("Security: oversize image (413)", () => {
  test("16MB zero-byte image base64 -> 413, no leftover session dir", async () => {
    const sessionId = `sec-big-${crypto.randomUUID()}`;
    toClean.add(getUploadDir(sessionId));

    try {
      const bigBase64 = Buffer.from(new Uint8Array(16 * 1024 * 1024)).toString("base64");
      const app = new Elysia().use(createUploadImagePlugin(serverConfig));
      const res = await postJson(app, {
        sessionId,
        base64: bigBase64,
        mediaType: "image/png",
      });

      expect(res.status).toBe(413);
      expect(existsSync(getUploadDir(sessionId))).toBe(false);
    } finally {
      rmSync(getUploadDir(sessionId), { recursive: true, force: true });
    }
  });
});
