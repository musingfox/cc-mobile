// upload-security.test.ts — committed security fixture (turn 3)
//
// Behavioral assertions (not grep) that cover:
//   - Path-traversal sessionId rejected by both upload endpoints (4xx, no canary)
//   - safeSessionDir rejection table
//   - Legal sessionId round-trip (200, path under uploadsRoot)
//   - Bad base64 → 400, no leftover dir
//   - Oversize base64 → 413, no leftover dir
//
// Hermetic: the uploads root is a child of a tmpdir() sandbox, so a traversal
// canary sits beside it — exactly where `../<name>` would land — and every
// write stays under tmpdir(). Random sessionIds and canary suffixes.
// Pattern: new Elysia().use(plugin) + app.handle(new Request(...))

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
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
  pushScope: "phone-last" as const,
};

const sandbox = mkdtempSync(join(tmpdir(), "upload-security-test-"));
const uploadsRoot = join(sandbox, "uploads");

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

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
    const canaryDir = join(sandbox, `cc-sec-${rand}`);
    toClean.add(canaryDir);
    const sessionId = `../cc-sec-${rand}`;

    try {
      const app = new Elysia().use(createUploadPlugin(serverConfig, uploadsRoot));
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
    const canaryDir = join(sandbox, `cc-sec-img-${rand}`);
    toClean.add(canaryDir);
    const sessionId = `../cc-sec-img-${rand}`;

    try {
      const app = new Elysia().use(createUploadImagePlugin(serverConfig, uploadsRoot));
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
    "fleet@..",
    "w1:p1/..",
    "fleet@w1:p1/../x",
    "..@w1:p1",
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
    toClean.add(getUploadDir(sessionId, uploadsRoot));

    try {
      const app = new Elysia().use(createUploadImagePlugin(serverConfig, uploadsRoot));
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
      rmSync(getUploadDir(sessionId, uploadsRoot), { recursive: true, force: true });
    }
  });
});

// ---- herdr session keys: pane id and hangar key -----------------------------------

// The status is asserted before anything derives a directory from the key, so a
// regression fails on the route's 400, not on a throw in the test's own setup.
describe("Security: herdr session keys upload into distinct directories", () => {
  const keys = ["w1:p1", "fleet@w1:p1"];

  async function uploadDirsFor(post: (sessionId: string) => Promise<Response>) {
    const dirs: string[] = [];
    for (const sessionId of keys) {
      const res = await post(sessionId);
      expect(res.status).toBe(200);
      const body = await res.json();
      const dir = dirname(resolve(body.path));
      toClean.add(dir);
      expect(dirname(dir)).toBe(resolve(uploadsRoot));
      dirs.push(dir);
    }
    expect(dirs[0]).not.toBe(dirs[1]);
  }

  test("/api/upload-image: cockpit 'w1:p1' and hangar 'fleet@w1:p1' -> 200 each, separate dirs", async () => {
    const app = new Elysia().use(createUploadImagePlugin(serverConfig, uploadsRoot));
    await uploadDirsFor((sessionId) =>
      postJson(app, { sessionId, base64: PNG_BASE64, mediaType: "image/png" }),
    );
  });

  test("/api/upload (multipart): cockpit 'w1:p1' and hangar 'fleet@w1:p1' -> 200 each, separate dirs", async () => {
    const app = new Elysia().use(createUploadPlugin(serverConfig, uploadsRoot));
    await uploadDirsFor((sessionId) => {
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("file", new File(["x".repeat(64)], "doc.pdf", { type: "application/pdf" }));
      return app.handle(
        new Request("http://localhost/api/upload", { method: "POST", body: formData }),
      );
    });
  });
});

// ---- Bad base64 → 400, no leftover dir ----------------------------------------------

describe("Security: bad base64 input hardening", () => {
  test("base64 with length not a multiple of 4 ('abc') -> 400, no session dir", async () => {
    const sessionId = `sec-b64-${crypto.randomUUID()}`;
    toClean.add(getUploadDir(sessionId, uploadsRoot));

    try {
      const app = new Elysia().use(createUploadImagePlugin(serverConfig, uploadsRoot));
      const res = await postJson(app, {
        sessionId,
        base64: "abc",
        mediaType: "image/png",
      });

      expect(res.status).toBe(400);
      expect(existsSync(getUploadDir(sessionId, uploadsRoot))).toBe(false);
    } finally {
      rmSync(getUploadDir(sessionId, uploadsRoot), { recursive: true, force: true });
    }
  });

  test("invalid base64 characters -> 4xx, no session dir", async () => {
    const sessionId = `sec-inv-${crypto.randomUUID()}`;
    toClean.add(getUploadDir(sessionId, uploadsRoot));

    try {
      const app = new Elysia().use(createUploadImagePlugin(serverConfig, uploadsRoot));
      const res = await postJson(app, {
        sessionId,
        base64: "!!!not-base64!!!",
        mediaType: "image/png",
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
      expect(existsSync(getUploadDir(sessionId, uploadsRoot))).toBe(false);
    } finally {
      rmSync(getUploadDir(sessionId, uploadsRoot), { recursive: true, force: true });
    }
  });
});

// ---- Oversize → 413, no leftover dir ------------------------------------------------

describe("Security: oversize image (413)", () => {
  test("16MB zero-byte image base64 -> 413, no leftover session dir", async () => {
    const sessionId = `sec-big-${crypto.randomUUID()}`;
    toClean.add(getUploadDir(sessionId, uploadsRoot));

    try {
      const bigBase64 = Buffer.from(new Uint8Array(16 * 1024 * 1024)).toString("base64");
      const app = new Elysia().use(createUploadImagePlugin(serverConfig, uploadsRoot));
      const res = await postJson(app, {
        sessionId,
        base64: bigBase64,
        mediaType: "image/png",
      });

      expect(res.status).toBe(413);
      expect(existsSync(getUploadDir(sessionId, uploadsRoot))).toBe(false);
    } finally {
      rmSync(getUploadDir(sessionId, uploadsRoot), { recursive: true, force: true });
    }
  });
});
