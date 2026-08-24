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
import { createAuditLog } from "./audit/audit-log";
import type { ServerConfig } from "./config";
import { EventBuffer } from "./event-buffer";
import { createHerdrBackend } from "./herdr/backend";
import { stripBasePath } from "./path-utils";
import { createAttemptLog } from "./push/attempt-log";
import { createPushNotifier } from "./push/notifier";
import { createPhoneDrivenTracker, type PhoneDrivenTracker } from "./push/phone-driven";
import { createPushPlugin } from "./push/plugin";
import { createPushSender, type PushTransport } from "./push/sender";
import { createSubscriptionStore } from "./push/subscription-store";
import { loadVapidKeys } from "./push/vapid";
import { evaluateRequestGate } from "./request-gate";
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
  /**
   * How many phones are registered for background push, read through the
   * backend rather than off the store directly — that is what proves the
   * subscribe route and the poll tier share one store. Optional: a test may
   * inject a backend that has no push wiring at all.
   */
  pushSubscriberCount?(): number;
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
  pushStore?: ReturnType<typeof createSubscriptionStore>;
  /**
   * The herdr client the default backend talks to. A probe can drive the whole
   * assembled chain — pane event → poll → notifier → sender — off a fake
   * daemon without stubbing anything above it.
   */
  herdrClient?: NonNullable<Parameters<typeof createHerdrBackend>[0]>["client"];
  /** 讓活體 e2e 的 pane 保留在預設 backend 組裝出的事件管線中。 */
  suppressSessionLabel?: NonNullable<
    Parameters<typeof createHerdrBackend>[0]
  >["suppressSessionLabel"];
  /**
   * The transport boundary, and the only thing a test may stand in for on the
   * push path: everything between `createApp` and here must be the real
   * article, or this whole seam goes untested again.
   */
  pushSend?: PushTransport;
  /** Keeps a probe's attempt lines out of the developer's own `~/.claude-mobile`. */
  pushAttemptLogPath?: string;
  /** 測試可注入路徑，避免把稽核紀錄寫進開發者的 `~/.claude-mobile`。 */
  auditLogPath?: string;
  /**
   * The push scope tracker. Injectable so an assembled-server test can drive
   * "the phone sent this" without going through a real pane.
   */
  phoneDriven?: PhoneDrivenTracker;
  /**
   * The environment the root request gate reads (`CC_MOBILE_TRUSTED_USER`,
   * `CC_MOBILE_ALLOWED_ORIGINS`). Production passes nothing and the gate falls
   * back to `process.env`; a test injects instead of mutating it, because
   * `bun test` runs every file in one process and a leaked
   * `CC_MOBILE_TRUSTED_USER` would 403 every later `createApp` test.
   */
  gateEnv?: Record<string, string | undefined>;
}

/** Builds the whole server. The returned app has not been listened on. */
export function createApp(serverConfig: ServerConfig, deps: AppTestDeps = {}) {
  const sessionManager = deps.sessionManager ?? new SessionManager();
  // WebSocket 入口與原生 pane 送鍵共用同一支延遲寫入器；
  // 只有真正寫入時才會建立目錄與檔案，單純組裝或 listen 不碰磁碟。
  const auditLog = createAuditLog(deps.auditLogPath ? { path: deps.auditLogPath } : {});

  // Persistent across reconnects; the WS plugin appends to it and replays from it.
  const eventBuffer = new EventBuffer(500);

  // Late-bound handle on the live socket. The WS plugin sets it on open and
  // clears it on close, which is what lets collaborators built here push to a
  // client that does not exist yet.
  const clientSink: ClientSink = { current: null };

  // One store, read by three parties: the subscribe route stores into it, the
  // sender sends to it, and the poll tier asks it whether anybody is listening.
  // Two instances here is the failure this whole feature is built to avoid.
  const pushStore = deps.pushStore ?? createSubscriptionStore();
  const sender = createPushSender({
    store: pushStore,
    attemptLog: createAttemptLog(deps.pushAttemptLogPath ? { path: deps.pushAttemptLogPath } : {}),
    ...(deps.pushSend ? { send: deps.pushSend } : {}),
  });

  // Who spoke into which pane last. The scope rule reads it; the backend feeds
  // it from the send path and the pane's own turn transitions.
  const phoneDriven = deps.phoneDriven ?? createPhoneDrivenTracker();
  const notifier = createPushNotifier({
    getSubscriptions: () => pushStore.list(),
    dispatch: (kind, subs, vapid) => sender.dispatch(kind, subs, vapid),
    // Read per dispatch, not captured: the keys are environment-only.
    getVapid: () => loadVapidKeys(),
    scope: serverConfig.pushScope,
    phoneDriven,
  });

  // herdr is the only default backend (ADR-015 / plan D1). Its transport
  // connects lazily, so constructing the app here contacts no daemon —
  // index.ts gates on daemon reachability before it listens.
  const backend: AppBackend =
    deps.backend ??
    createHerdrBackend({
      ...(deps.herdrClient ? { client: deps.herdrClient } : {}),
      ...(deps.suppressSessionLabel ? { suppressSessionLabel: deps.suppressSessionLabel } : {}),
      push: {
        onPromptSent: (paneId) => phoneDriven.markSent(paneId),
        onTurnStart: (paneId) => phoneDriven.onTurnStart(paneId),
        onTurnSettled: async (paneId) => {
          // Read the verdict before spending the token: `onTurnSettled` on the
          // tracker clears it, and the notifier is what reads it.
          await notifier.onTurnSettled(paneId);
          phoneDriven.onTurnSettled(paneId);
        },
        onPermissionPrompt: (paneId) => notifier.onPermissionPrompt(paneId),
        subscriberCount: () => pushStore.count(),
      },
      onKeysSent: (paneId, source, outcome) =>
        auditLog.append({
          action: source === "auto_deny" ? "auto_deny" : "permission_keys_send",
          paneId,
          ip: null,
          device: null,
          outcome,
        }),
    });

  if (deps.backendRef) deps.backendRef.current = backend;

  // No shutdown signal handler: pane survival across a stop is the persistence
  // default (plan D2). A SIGTERM from pm2 or a deploy must leave the panes — and
  // the live claude in them — alone. The next startup rediscovers nothing and
  // needs to: the session list is a live `agent.list` query (Decision M12).
  // `backend.teardownAll` stays on the port for explicit callers.

  // The root gate is chained before every route, so it covers the `/ws`
  // upgrade, `/api/*` and the static catch-all alike — an identity check that
  // only guarded plain HTTP would guard nothing, since the WebSocket is the way
  // in. It reads `process.env` unless a test injects `gateEnv`.
  return new Elysia({
    websocket: {
      idleTimeout: WS_IDLE_TIMEOUT_SECONDS,
      sendPings: true,
    },
  })
    .onRequest(({ request }) => evaluateRequestGate(request, deps.gateEnv ?? process.env))
    .use(
      createWsPlugin(sessionManager, serverConfig, { backend, eventBuffer, clientSink, auditLog }),
    )
    .use(createUploadPlugin(serverConfig))
    .use(createUploadImagePlugin(serverConfig))
    .use(createPushPlugin({ store: pushStore, config: serverConfig }))
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
