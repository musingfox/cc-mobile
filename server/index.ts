import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Elysia } from "elysia";
import { parseServerConfig } from "./config";
import { createPermissionHandler } from "./permission-bridge";
import { SessionManager } from "./session-manager";
import { createWsPlugin } from "./ws";

const serverConfig = parseServerConfig(process.argv);
const sessionManager = new SessionManager({ permissionMode: serverConfig.permissionMode });

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist", "client");

const _app = new Elysia()
  .use(createWsPlugin(sessionManager, createPermissionHandler, serverConfig))
  .get("*", async ({ request }) => {
    // Skip if dist/ doesn't exist (dev mode)
    if (!existsSync(DIST_DIR)) {
      return new Response("Not found", { status: 404 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = join(DIST_DIR, pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(DIST_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    // Fallback to index.html for SPA routing
    if (pathname !== "/index.html") {
      const indexFile = Bun.file(join(DIST_DIR, "index.html"));
      if (await indexFile.exists()) {
        return new Response(indexFile);
      }
    }

    return new Response("Not found", { status: 404 });
  })
  .listen({ port: serverConfig.port, hostname: serverConfig.hostname });

console.log(`cc-mobile server listening on ${serverConfig.hostname}:${serverConfig.port}`);
