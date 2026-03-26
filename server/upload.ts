import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Elysia, t } from "elysia";
import type { ServerConfig } from "./config";
import { buildUrl } from "./path-utils";
import { ensureUploadDir } from "./upload-manager";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export function createUploadPlugin(serverConfig: ServerConfig) {
  const uploadPath = buildUrl(serverConfig.basePath, "/api/upload");

  return new Elysia().post(
    uploadPath,
    async ({ body }) => {
      const { sessionId, file } = body;

      if (!sessionId) {
        return new Response(JSON.stringify({ error: "sessionId is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!file || file.size === 0) {
        return new Response(JSON.stringify({ error: "file is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (file.size > MAX_FILE_SIZE) {
        return new Response(JSON.stringify({ error: "File size exceeds 100MB limit" }), {
          status: 413,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const uploadDir = await ensureUploadDir(sessionId);
        const uuid = crypto.randomUUID();
        const ext = extname(file.name);
        const filename = `${uuid}${ext}`;
        const filepath = join(uploadDir, filename);

        // Write file to disk
        const arrayBuffer = await file.arrayBuffer();
        await writeFile(filepath, new Uint8Array(arrayBuffer));

        const sizeKB = Math.round(file.size / 1024);

        return {
          path: filepath,
          filename: file.name,
          sizeKB,
        };
      } catch (err) {
        console.error("[upload] failed to save file:", err);
        return new Response(JSON.stringify({ error: "Failed to save file" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        file: t.File(),
      }),
    },
  );
}
