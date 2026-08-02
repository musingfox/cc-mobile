/**
 * app.ts — the composition root.
 *
 * Everything the server is made of is assembled here: the terminal backend, the
 * WS transport plugin, uploads, and static file serving.
 * `createApp` returns the app *unlistened*, so wiring can be asserted without
 * binding a port; `index.ts` is reduced to parse-config → createApp → listen.
 *
 * There are no hook endpoints any more. cc-mobile used to POST claude's Stop and
 * PreToolUse hooks back into this process to read replies and intercept
 * permissions; since #29 both come from herdr directly — replies from claude's
 * transcript file, permissions from the pane's own screen — which is what makes
 * a session the user started in their own terminal work identically to one
 * cc-mobile launched. Closing #28 with it: with no `/api/pty-response` route in
 * the tree there is no startup window in which a hook POST can be lost.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Elysia } from "elysia";
import type { ServerConfig } from "./config";
import { EventBuffer } from "./event-buffer";
import { createHerdrBackend } from "./herdr/backend";
import { stripBasePath } from "./path-utils";
import { SessionManager } from "./session-manager";
import { createUploadPlugin } from "./upload";
import { createUploadImagePlugin } from "./upload-image";
import { type ClientSink, createWsPlugin, type WsBackend } from "./ws";

export const WS_IDLE_TIMEOUT_SECONDS = 240;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DIST_DIR = join(__dirname, "..", "dist", "client");

/**
 * The terminal backend as the composition root uses it: everything the WS
 * transport needs, plus the lookup/shutdown surface the signal handlers drive.
 */
export interface AppBackend extends WsBackend {
  hasSession(claudeUuid: string): { present: boolean; paneRef?: string };
  getClient(claudeUuid: string): ((msg: Record<string, unknown>) => void) | undefined;
  teardownAll(): Promise<void>;
}

/**
 * Injection seam for tests (additive; production passes nothing). Substituting
 * a spy backend exercises the wiring without spawning a pane or binding a port.
 *
 * `backendRef` is the exception — production passes it. `createApp` returns the
 * Elysia app, but `index.ts` needs the backend it built, so it hands in a cell
 * for createApp to fill. Late-bound out-params are already how this file shares
 * `clientSink`.
 */
export interface AppTestDeps {
  backend?: AppBackend;
  backendRef?: { current: AppBackend | null };
  sessionManager?: SessionManager;
}

/** Builds the whole server. The returned app has not been listened on. */
export function createApp(serverConfig: ServerConfig, deps: AppTestDeps = {}) {
  const sessionManager =
    deps.sessionManager ?? new SessionManager({ permissionMode: serverConfig.permissionMode });

  // Persistent across reconnects; the WS plugin appends to it and replays from it.
  const eventBuffer = new EventBuffer(500);

  // Late-bound handle on the live socket. The WS plugin sets it on open and
  // clears it on close, which is what lets collaborators built here push to a
  // client that does not exist yet.
  const clientSink: ClientSink = { current: null };

  // herdr is the only default backend (ADR-015 / plan D1). Its transport
  // connects lazily, so constructing the app here contacts no daemon —
  // index.ts gates on daemon reachability before it listens.
  const backend: AppBackend =
    deps.backend ?? createHerdrBackend({ permissionMode: serverConfig.permissionMode });

  if (deps.backendRef) deps.backendRef.current = backend;

  // No shutdown signal handler: pane survival across a stop is the persistence
  // default (plan D2). A SIGTERM from pm2 or a deploy must leave the panes — and
  // the live claude in them — alone. The next startup rediscovers nothing and
  // needs to: the session list is a live `agent.list` query (Decision M12).
  // `backend.teardownAll` stays on the port for explicit callers.

  return new Elysia({
    websocket: {
      idleTimeout: WS_IDLE_TIMEOUT_SECONDS,
      sendPings: true,
    },
  })
    .use(createWsPlugin(sessionManager, serverConfig, { backend, eventBuffer, clientSink }))
    .use(createUploadPlugin(serverConfig))
    .use(createUploadImagePlugin(serverConfig))
    .get("*", async ({ request }) => {
      // Skip if dist/ doesn't exist (dev mode)
      if (!existsSync(DIST_DIR)) {
        return new Response("Not found", { status: 404 });
      }

      const url = new URL(request.url);
      let pathname = stripBasePath(url.pathname, serverConfig.basePath);
      pathname = pathname === "/" ? "/index.html" : pathname;
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
    });
}
