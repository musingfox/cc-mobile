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
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Elysia } from "elysia";
import { type AgentProfileSource, createAgentProfileSource } from "./agents/profiles";
import { createAuditLog } from "./audit/audit-log";
import type { ServerConfig } from "./config";
import { EventBuffer } from "./event-buffer";
import { createHerdrBackend } from "./herdr/backend";
import { createHerdrClient, type HerdrClient } from "./herdr/client";
import { createSidedBackend } from "./herdr/sided-backend";
import { hangarKey, resolveHerdrSides, routeSessionKey, type Side } from "./herdr/sides";
import { createSocketWatch, type SocketWatchOptions } from "./herdr/socket-watch";
import { createLaunchPlugin } from "./launch";
import { defaultLaunchesDir } from "./launch-binding";
import { stripBasePath } from "./path-utils";
import { createAttemptLog } from "./push/attempt-log";
import { createForegroundTracker } from "./push/foreground";
import { createPushNotifier, type NotifierTimers } from "./push/notifier";
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

/** How long the hangar socket stays unreachable before the phone is told (ADR-018). */
export const HANGAR_OFFLINE_ALARM_MS = 300_000;

type HerdrBackendClient = NonNullable<Parameters<typeof createHerdrBackend>[0]>["client"];
type WatchableClient = NonNullable<HerdrBackendClient> &
  Partial<Pick<HerdrClient, "assertCompatible">>;

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
  /** Opens the event streams and watches without waiting for a phone. */
  start?(): void;
  /**
   * How many phones are registered for background push, read through the
   * backend rather than off the store directly — that is what proves the
   * subscribe route and the poll tier share one store. Optional: a test may
   * inject a backend that has no push wiring at all.
   */
  pushSubscriberCount?(): number;
  /** A pane's working directory for push copy. Optional for the same reason. */
  paneCwd?(paneId: string): Promise<string | null>;
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
  herdrClient?: HerdrBackendClient;
  /** The same seam for the hangar socket; read only when `hangarSession` is set. */
  hangarHerdrClient?: HerdrBackendClient;
  /** Timing seams for the per-socket reachability watches. */
  socketWatchTimers?: Pick<
    SocketWatchOptions,
    "now" | "setIntervalFn" | "clearIntervalFn" | "intervalMs"
  >;
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
  /** Injectable timer pair for deferred turn pushes. */
  pushTimers?: NotifierTimers;
  /**
   * The environment the root request gate reads (`CC_MOBILE_TRUSTED_USER`,
   * `CC_MOBILE_ALLOWED_ORIGINS`). Production passes nothing and the gate falls
   * back to `process.env`; a test injects instead of mutating it, because
   * `bun test` runs every file in one process and a leaked
   * `CC_MOBILE_TRUSTED_USER` would 403 every later `createApp` test.
   */
  gateEnv?: Record<string, string | undefined>;
  agentProfiles?: AgentProfileSource;
  /** Where launch bindings are written; production uses the writeback hook's default. */
  launchesDir?: string;
  /** The built client to serve; production serves `DIST_DIR`. */
  distDir?: string;
  /**
   * The replay buffer, so a test can tell that an event landed while no socket
   * was open — the one moment nothing else can observe it.
   */
  eventBuffer?: EventBuffer;
}

/** Builds the whole server. The returned app has not been listened on. */
export function createApp(serverConfig: ServerConfig, deps: AppTestDeps = {}) {
  const hangarSession = serverConfig.hangarSession ?? null;
  const sessionManager = deps.sessionManager ?? new SessionManager();
  const distDir = deps.distDir ?? DIST_DIR;
  // WebSocket 入口與原生 pane 送鍵共用同一支延遲寫入器；
  // 只有真正寫入時才會建立目錄與檔案，單純組裝或 listen 不碰磁碟。
  const auditLog = createAuditLog(deps.auditLogPath ? { path: deps.auditLogPath } : {});

  // Persistent across reconnects; the WS plugin appends to it and replays from it.
  const eventBuffer = deps.eventBuffer ?? new EventBuffer(500);

  // Late-bound handle on the live socket. The WS plugin sets it on open and
  // clears it on close, which is what lets collaborators built here push to a
  // client that does not exist yet.
  const clientSink: ClientSink = { current: null };

  // One store, read by three parties: the subscribe route stores into it, the
  // sender sends to it, and the poll tier asks it whether anybody is listening.
  // Two instances here is the failure this whole feature is built to avoid.
  const pushStore = deps.pushStore ?? createSubscriptionStore();
  // One tracker, written by the WS transport and read by the sender.
  const foreground = createForegroundTracker();
  const sender = createPushSender({
    store: pushStore,
    attemptLog: createAttemptLog(deps.pushAttemptLogPath ? { path: deps.pushAttemptLogPath } : {}),
    ...(deps.pushSend ? { send: deps.pushSend } : {}),
    isForeground: (device) => foreground.isForeground(device),
  });

  // Who spoke into which pane last. The scope rule reads it; the backend feeds
  // it from the send path and the pane's own turn transitions.
  const phoneDriven = deps.phoneDriven ?? createPhoneDrivenTracker();
  const notifier = createPushNotifier({
    getSubscriptions: () => pushStore.list(),
    dispatch: (kind, subs, vapid, about) => sender.dispatch(kind, subs, vapid, about),
    // Read per dispatch, not captured: the keys are environment-only.
    getVapid: () => loadVapidKeys(),
    // Late-bound: the backend is built below, and this runs only once a pane
    // has a push to send.
    cwdOf: (paneId) => backend.paneCwd?.(paneId) ?? Promise.resolve(null),
    isHangarPane: (key) => routeSessionKey(key, hangarSession).side === "hangar",
    scope: serverConfig.pushScope,
    phoneDriven,
    ...deps.pushTimers,
  });

  // herdr is the only default backend (ADR-015 / plan D1). Each client's
  // transport connects lazily, so constructing the app here contacts no
  // daemon; an unreachable one is watched and retried once `start()` runs
  // (ADR-018). index.ts exits before listening only for a daemon that answered
  // and cannot be driven.
  const sockets = resolveHerdrSides(hangarSession);
  const cockpitSocket = sockets[0];
  const hangarSocket = sockets.find((side) => side.side === "hangar");

  // The one factory both backends take their hooks from: a hangar pane's key
  // is prefixed on the way out, so a cockpit pane with the same id is never
  // the one a push or an audit line names.
  const hooksFor = (keyOf: (paneId: string) => string) => ({
    push: {
      onPromptSent: (paneId: string) => phoneDriven.markSent(keyOf(paneId)),
      onTurnStart: (paneId: string) => phoneDriven.onTurnStart(keyOf(paneId)),
      onTurnSettled: (paneId: string) => phoneDriven.onTurnSettled(keyOf(paneId)),
      onAgentStatus: (paneId: string, status: string) =>
        notifier.onAgentStatus(keyOf(paneId), status),
      forget: (paneId: string) => {
        notifier.forget(keyOf(paneId));
        phoneDriven.forget(keyOf(paneId));
      },
      subscriberCount: () => pushStore.count(),
    },
    onKeysSent: (
      paneId: string,
      source: "permission_answer" | "auto_deny",
      outcome: "sent" | "failed",
    ) =>
      auditLog.append({
        action: source === "auto_deny" ? "auto_deny_keys_send" : "permission_keys_send",
        paneId: keyOf(paneId),
        ip: null,
        device: null,
        outcome,
      }),
  });

  const watchFor = (
    side: Side,
    socketPath: string,
    client: WatchableClient,
    offlineAlarm?: SocketWatchOptions["offlineAlarm"],
  ) =>
    client.assertCompatible
      ? createSocketWatch({
          side,
          socketPath,
          probe: () => client.assertCompatible?.() ?? Promise.resolve(),
          ...(offlineAlarm ? { offlineAlarm } : {}),
          ...deps.socketWatchTimers,
        })
      : undefined;

  function buildSidedBackend() {
    const cockpitClient: WatchableClient =
      deps.herdrClient ?? createHerdrClient({ socketPath: cockpitSocket.socketPath });
    const cockpit = {
      backend: createHerdrBackend({
        client: cockpitClient,
        ...(deps.suppressSessionLabel ? { suppressSessionLabel: deps.suppressSessionLabel } : {}),
        ...hooksFor((paneId) => paneId),
      }),
      watch: watchFor("cockpit", cockpitSocket.socketPath, cockpitClient),
    };
    if (!hangarSocket || hangarSocket.side !== "hangar") return createSidedBackend({ cockpit });
    const name = hangarSocket.name;
    const hangarClient: WatchableClient =
      deps.hangarHerdrClient ?? createHerdrClient({ socketPath: hangarSocket.socketPath });
    return createSidedBackend({
      cockpit,
      hangar: {
        name,
        backend: createHerdrBackend({
          client: hangarClient,
          // A hangar prompt waits for a human; no unattended esc (ADR-015 §2026-10-09).
          unattendedDeny: false,
          ...hooksFor((paneId) => hangarKey(name, paneId)),
        }),
        watch: watchFor("hangar", hangarSocket.socketPath, hangarClient, {
          afterMs: HANGAR_OFFLINE_ALARM_MS,
          onAlarm: () =>
            sender.dispatch("hangar_offline", pushStore.list(), loadVapidKeys() ?? undefined),
        }),
      },
    });
  }

  const agentProfiles = deps.agentProfiles ?? createAgentProfileSource();
  const backend: AppBackend = deps.backend ?? buildSidedBackend();

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
      createWsPlugin(sessionManager, serverConfig, {
        backend,
        eventBuffer,
        clientSink,
        auditLog,
        agentProfiles,
        foreground,
      }),
    )
    .use(createUploadPlugin(serverConfig))
    .use(createUploadImagePlugin(serverConfig))
    .use(createPushPlugin({ store: pushStore, config: serverConfig }))
    .use(
      createLaunchPlugin({
        config: serverConfig,
        backend,
        agentProfiles,
        auditLog,
        eventBuffer,
        launchesDir: deps.launchesDir ?? defaultLaunchesDir(),
      }),
    )
    .get("*", async ({ request }) => {
      // Skip if dist/ doesn't exist (dev mode)
      if (!existsSync(distDir)) {
        return new Response("Not found", { status: 404 });
      }

      const url = new URL(request.url);
      let pathname = stripBasePath(url.pathname, serverConfig.basePath);
      pathname = pathname === "/" ? "/index.html" : pathname;
      const filePath = join(distDir, pathname);

      // Prevent directory traversal
      if (!filePath.startsWith(distDir)) {
        return new Response("Forbidden", { status: 403 });
      }

      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }

      // Only a page navigation falls back to index.html. A missed asset — a
      // hashed chunk a deploy removed — answered with HTML and status 200 is
      // stored by the service worker as that chunk.
      const isNavigation =
        extname(pathname) === "" && (request.headers.get("accept") ?? "").includes("text/html");
      if (isNavigation) {
        const indexFile = Bun.file(join(distDir, "index.html"));
        if (await indexFile.exists()) {
          return new Response(indexFile);
        }
      }

      return new Response("Not found", { status: 404 });
    });
}
