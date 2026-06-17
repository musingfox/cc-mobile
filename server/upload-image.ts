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

    // Decode base64 BEFORE creating any directory
    let bytes: Uint8Array;
    try {
      const binaryStr = atob(base64);
      bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
    } catch {
      set.status = 400;
      return { error: "invalid base64" };
    }

    // Size cap check — before creating directory
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
