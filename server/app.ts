/**
 * app.ts — the composition root.
 *
 * Everything the server is made of is assembled here: the terminal backend, the
 * PTY orchestrator, the permission/response relays, the HTTP hook endpoints,
 * the WS transport plugin, and static file serving.
 * `createApp` returns the app *unlistened*, so wiring can be asserted without
 * binding a port; `index.ts` is reduced to parse-config → createApp → listen.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Elysia } from "elysia";
import type { ServerConfig } from "./config";
import { EventBuffer } from "./event-buffer";
import { createHerdrBackend } from "./herdr/backend";
import { buildUrl, stripBasePath } from "./path-utils";
import { createPermissionHandler } from "./permission-bridge";
import { PtyOrchestrator } from "./pty-orchestrator";
import { createPtyPermissionHandler } from "./pty-permission-endpoint";
import { createPtyPermissionRelay } from "./pty-permission-relay";
import { createPtyResponseHandler } from "./pty-response-endpoint";
import { createPtyResponseRelay } from "./pty-response-relay";
import { SessionManager } from "./session-manager";
import { createUploadPlugin } from "./upload";
import { createUploadImagePlugin } from "./upload-image";
import { type ClientSink, createWsPlugin, type WsBackend } from "./ws";

export const WS_IDLE_TIMEOUT_SECONDS = 240;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DIST_DIR = join(__dirname, "..", "dist", "client");

/**
 * The terminal backend as the composition root uses it: everything the WS
 * transport needs, plus the lookup/shutdown surface the relays and signal
 * handlers drive.
 */
export interface AppBackend extends WsBackend {
  hasSession(claudeUuid: string): { present: boolean; paneRef?: string };
  getClient(claudeUuid: string): ((msg: Record<string, unknown>) => void) | undefined;
  teardownAll(): Promise<void>;
}

/**
 * Injection seam for tests (additive; production passes nothing). Substituting
 * a spy backend or relay factory exercises the wiring without spawning tmux or
 * binding a port.
 */
export interface AppTestDeps {
  backend?: AppBackend;
  createTmuxPermissionRelay?: typeof createPtyPermissionRelay;
  sessionManager?: SessionManager;
  permissionBridgeFactory?: typeof createPermissionHandler;
}

/** Builds the whole server. The returned app has not been listened on. */
export function createApp(serverConfig: ServerConfig, deps: AppTestDeps = {}) {
  const sessionManager =
    deps.sessionManager ?? new SessionManager({ permissionMode: serverConfig.permissionMode });
  const permissionBridgeFactory = deps.permissionBridgeFactory ?? createPermissionHandler;
  const makeTmuxPermissionRelay = deps.createTmuxPermissionRelay ?? createPtyPermissionRelay;

  const ptyPermApiPath = buildUrl(serverConfig.basePath, "/api/pty-permission");
  const ptyResponseApiPath = buildUrl(serverConfig.basePath, "/api/pty-response");

  // Persistent across reconnects; the WS plugin appends to it and replays from it.
  const eventBuffer = new EventBuffer(500);

  // Late-bound handle on the live socket. The WS plugin sets it on open and
  // clears it on close, which is what lets relays built here push to a client
  // that does not exist yet.
  const clientSink: ClientSink = { current: null };

  // PTY permission relay. Note this deliberately does NOT buffer when no socket
  // is attached — unlike sendBuffered, which always appends first. Appending
  // here on a dead socket would replay a permission prompt the client never saw.
  const ptyRelay = createPtyPermissionRelay((sessionId, requestId, tool) => {
    if (clientSink.current) {
      const eventId = eventBuffer.append(sessionId, {
        type: "permission_request",
        sessionId,
        requestId,
        tool,
      });
      clientSink.current({
        type: "event",
        eventId,
        sessionId,
        payload: { type: "permission_request", sessionId, requestId, tool },
      });
    }
  });

  // PTY response relay + HTTP handler — the Stop hook delivers the assistant
  // reply here, resolving the in-flight drive() (ADR-011 readback).
  const ptyResponseRelay = createPtyResponseRelay();
  const ptyResponseHttpHandler = createPtyResponseHandler({ relay: ptyResponseRelay });

  // Hook URLs point at this server's own port + basePath, so a hook fired from
  // inside a tmux pane reaches the live process.
  const tmuxResponseUrl = `http://127.0.0.1:${serverConfig.port}${ptyResponseApiPath}`;
  const tmuxPermissionUrl = `http://127.0.0.1:${serverConfig.port}${ptyPermApiPath}`;

  // herdr is the only default backend (ADR-015 / plan D1). Its transport
  // connects lazily, so constructing the app here contacts no daemon —
  // index.ts gates on daemon reachability before it listens.
  const backend: AppBackend =
    deps.backend ??
    createHerdrBackend({
      responseUrl: tmuxResponseUrl,
      permissionUrl: tmuxPermissionUrl,
      responseRelay: ptyResponseRelay,
    });

  // PTY orchestrator — per-session --settings injection (ADR-014) reuses the same
  // loopback hook URLs as tmux, so PTY readback/permissions do not depend on the
  // global ~/.claude/settings.json.
  const ptyOrchestrator = new PtyOrchestrator({
    settings: { responseUrl: tmuxResponseUrl, permissionUrl: tmuxPermissionUrl },
  });

  // No shutdown signal handler: pane survival across a stop is the persistence
  // default (plan D2). A SIGTERM from pm2 or a deploy must leave the panes — and
  // the live claude in them — alone, so the next startup can remount them.
  // `backend.teardownAll` stays on the port for explicit callers; only the
  // signal wiring is gone. Panes whose claude did die are collected by the
  // startup orphan scan instead.

  // Independent tmux permission relay; sendToClient goes through the
  // claudeUuid→sink map so a permission_request only reaches the originating
  // client. 90s rather than the relay's 600s default: an unattended tmux prompt
  // should not hold a turn open for ten minutes.
  const tmuxPermissionRelay = makeTmuxPermissionRelay(
    (sessionId, requestId, tool) => {
      const sink = backend.getClient(sessionId);
      if (sink) {
        // sink is the sendBuffered wrapper, which already appends to the event
        // buffer; appending here too would replay the prompt twice.
        sink({
          type: "permission_request",
          sessionId,
          requestId,
          tool,
        });
      }
    },
    { timeoutMs: 90000 },
  );

  // Permission requests arrive over HTTP from the hook; route tmux-owned
  // sessions to the tmux relay and everything else to the PTY relay.
  const ptyPermissionHttpHandler = createPtyPermissionHandler({
    relay: {
      requestPtyPermission: (params: any) => {
        if (backend.hasSession(params.sessionId).present) {
          return tmuxPermissionRelay.requestPtyPermission(params);
        }
        return ptyRelay.requestPtyPermission(params);
      },
    } as any,
    hasSession: (sessionId: string) =>
      ptyOrchestrator.hasSession(sessionId) || backend.hasSession(sessionId).present,
  });

  return new Elysia({
    websocket: {
      idleTimeout: WS_IDLE_TIMEOUT_SECONDS,
      sendPings: true,
    },
  })
    .post(ptyPermApiPath, ({ request }) => ptyPermissionHttpHandler(request))
    .post(ptyResponseApiPath, ({ request }) => ptyResponseHttpHandler(request))
    .use(
      createWsPlugin(sessionManager, permissionBridgeFactory, serverConfig, {
        backend,
        ptyOrchestrator,
        ptyRelay,
        tmuxPermissionRelay,
        ptyResponseRelay,
        eventBuffer,
        clientSink,
      }),
    )
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
