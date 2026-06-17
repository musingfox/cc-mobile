import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Elysia } from "elysia";
import type { ServerConfig } from "./config";
import { buildUrl } from "./path-utils";
import { ensureUploadDir, safeSessionDir } from "./upload-manager";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

const EXT_MAP: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function mediaTypeToExt(mediaType: string): string {
  return EXT_MAP[mediaType] ?? ".bin";
}

// H3 decode seam — exported so tests can inject a spy.
// ALL base64 decoding in this module routes through this function.
export function decodeBase64(s: string): Uint8Array {
  const binaryStr = atob(s);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

export function createUploadImagePlugin(serverConfig: ServerConfig) {
  const uploadPath = buildUrl(serverConfig.basePath, "/api/upload-image");

  return new Elysia().post(uploadPath, async ({ body, set }) => {
    const { sessionId, base64, mediaType } = body as {
      sessionId?: string;
      base64?: string;
      mediaType?: string;
    };

    if (!sessionId) {
      set.status = 400;
      return { error: "sessionId is required" };
    }

    // Guard: validate sessionId before touching the filesystem
    try {
      safeSessionDir(sessionId);
    } catch {
      set.status = 400;
      return { error: "invalid sessionId" };
    }

    if (!base64) {
      set.status = 400;
      return { error: "base64 is required" };
    }

    // H3: early-reject on string length before decode — and before any other
    // per-character check. base64 expands by 4/3, so if length > MAX * 4/3
    // the decoded size would exceed the cap. Reject with 413 immediately,
    // and do NOT call decodeBase64. This check runs first so that an
    // oversize string gets 413 even if it also happens to fail % 4.
    const MAX_BASE64_LEN = Math.ceil((MAX_IMAGE_SIZE * 4) / 3);
    if (base64.length > MAX_BASE64_LEN) {
      set.status = 413;
      return { error: "image exceeds size limit" };
    }

    // H2: strict base64 — length must be a multiple of 4.
    // Bun's atob() does NOT throw on bad length (silently truncates),
    // so we must validate BEFORE calling decode.
    if (base64.length % 4 !== 0) {
      set.status = 400;
      return { error: "invalid base64: length must be a multiple of 4" };
    }

    // Decode base64 BEFORE creating any directory.
    // Uses the injectable seam so tests can spy on call count.
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(base64);
    } catch {
      set.status = 400;
      return { error: "invalid base64" };
    }

    // H2 follow-up: decode yielded 0 usable bytes (e.g. "=" alone).
    if (bytes.length === 0) {
      set.status = 400;
      return { error: "invalid base64: decodes to empty" };
    }

    // Size cap check — before creating directory.
    // (belt-and-suspenders: the length early-reject above already gates most cases)
    if (bytes.length > MAX_IMAGE_SIZE) {
      set.status = 413;
      return { error: "image exceeds size limit" };
    }

    try {
      const uploadDir = await ensureUploadDir(sessionId);
      const uuid = crypto.randomUUID();
      const ext = mediaTypeToExt(mediaType ?? "");
      const filename = `${uuid}${ext}`;
      const filepath = join(uploadDir, filename);

      await writeFile(filepath, bytes);

      const sizeKB = Math.round(bytes.length / 1024);

      return { path: filepath, sizeKB };
    } catch (err) {
      console.error("[upload-image] failed to save file:", err);
      set.status = 500;
      return { error: "Failed to save file" };
    }
  });
}
