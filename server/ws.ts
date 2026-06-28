import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Elysia, t } from "elysia";
import {
  type Capabilities,
  loadCachedCapabilities,
  saveCachedCapabilities,
} from "./capabilities-cache";
import type { ServerConfig } from "./config";
import { EventBuffer } from "./event-buffer";
import { buildUrl, resolveAndValidateCwd } from "./path-utils";
import type { createPermissionHandler, PendingPermissionSnapshot } from "./permission-bridge";
import { ClientMessage, ServerMessage } from "./protocol";
import { PtyOrchestrator } from "./pty-orchestrator";
import { createPtyPermissionHandler } from "./pty-permission-endpoint";
import { createPtyPermissionRelay, type PtyRelaySnapshot } from "./pty-permission-relay";
import { createPtyResponseHandler } from "./pty-response-endpoint";
import { createPtyResponseRelay } from "./pty-response-relay";
import { loadSessionHistory } from "./session-history";
import { getClaudeSessionInfo, listClaudeSessions, renameClaudeSession } from "./session-listing";
import type { InitData, SessionManager } from "./session-manager";
import { createTmuxRegistry } from "./tmux-registry";
import { createTmuxSendRouting } from "./tmux-send-routing";

// Idempotency guard (DP-1): ensure tmux teardown signal handlers are registered
// at most once per process, even if createWsPlugin is invoked multiple times.
let tmuxShutdownHandlersRegistered = false;

function expandPath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

function validateCwd(cwd: string): string | null {
  if (!existsSync(cwd)) return `Path does not exist: ${cwd}`;
  if (!statSync(cwd).isDirectory()) return `Not a directory: ${cwd}`;
  return null;
}

function validateAllowedPath(cwd: string, allowedRoots: string[] | null): boolean {
  if (allowedRoots === null) {
    return true;
  }

  // Normalize cwd to absolute and resolve symlinks
  let normalizedCwd: string;
  try {
    normalizedCwd = realpathSync(cwd);
  } catch {
    // If realpath fails, use resolved path
    normalizedCwd = resolve(cwd);
  }

  // Ensure path ends with separator for prefix matching
  const ensureTrailingSep = (p: string) => (p.endsWith(sep) ? p : p + sep);

  for (const root of allowedRoots) {
    let normalizedRoot: string;
    try {
      normalizedRoot = realpathSync(root);
    } catch {
      normalizedRoot = resolve(root);
    }

    // Check if cwd is exactly the root or starts with root/
    if (
      normalizedCwd === normalizedRoot ||
      normalizedCwd.startsWith(ensureTrailingSep(normalizedRoot))
    ) {
      return true;
    }
  }

  return false;
}

export function getInitialBrowsePath(allowedRoots: string[] | null, homeDirectory: string): string {
  if (allowedRoots && allowedRoots.length > 0) {
    return allowedRoots[0];
  }
  return homeDirectory;
}

type PermissionHandlerFactory = typeof createPermissionHandler;
type PermissionHandler = ReturnType<PermissionHandlerFactory>;

interface WsData {
  currentSessionId?: string;
  ptySessionIds: Set<string>;
}

export function buildCachedCapabilities(
  msg: Record<string, unknown>,
  initData: InitData | null,
): Capabilities {
  const toNamed = <T extends { name: string }>(arr: unknown): T[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => {
        if (typeof item === "string") return { name: item } as T;
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { name?: unknown }).name === "string"
        ) {
          return item as T;
        }
        return null;
      })
      .filter((x): x is T => x !== null);
  };

  return {
    commands: toNamed(msg.slash_commands),
    agents: toNamed(msg.agents),
    model: (msg.model as string) || "unknown",
    ...(initData ? { models: initData.models, accountInfo: initData.account } : {}),
  };
}

// ---------------------------------------------------------------------------
// Capabilities emit helpers — extracted seams (logic-free; byte-equivalent)
// ---------------------------------------------------------------------------

/** open/reconnect path: bare ws.send, no sessionId */
export function emitCapabilitiesOnOpen(
  ws: { send: (msg: Record<string, unknown>) => void },
  cachedCapabilities: Capabilities | null,
): void {
  if (cachedCapabilities) {
    ws.send({
      type: "capabilities",
      ...cachedCapabilities,
    });
  }
}

/** init path: sendBuffered with sessionId */
export function emitCapabilitiesOnInit(
  sendBuf: (ws: any, sessionId: string, msg: Record<string, unknown>) => void,
  ws: any,
  sessionId: string,
  cachedCapabilities: Capabilities,
): void {
  sendBuf(ws, sessionId, {
    type: "capabilities",
    sessionId,
    ...cachedCapabilities,
  });
}

/** resume path: sendBuffered with sessionId */
export function emitCapabilitiesOnResume(
  sendBuf: (ws: any, sessionId: string, msg: Record<string, unknown>) => void,
  ws: any,
  sessionId: string,
  cachedCapabilities: Capabilities | null,
): void {
  if (cachedCapabilities) {
    sendBuf(ws, sessionId, {
      type: "capabilities",
      sessionId,
      ...cachedCapabilities,
    });
  }
}

/**
 * Optional injection seam for tests (additive; production passes nothing).
 * Lets a test substitute a spy registry / relay factory to exercise tmux
 * lifecycle wiring (DP-1 signal teardown, EX-A2 relay timeout) without spawning.
 */
export interface WsPluginTestDeps {
  createTmuxRegistry?: typeof createTmuxRegistry;
  createTmuxPermissionRelay?: typeof createPtyPermissionRelay;
}

export function createWsPlugin(
  sessionManager: SessionManager,
  permissionBridgeFactory: PermissionHandlerFactory,
  serverConfig: ServerConfig,
  deps: WsPluginTestDeps = {},
) {
  const makeTmuxRegistry = deps.createTmuxRegistry ?? createTmuxRegistry;
  const makeTmuxPermissionRelay = deps.createTmuxPermissionRelay ?? createPtyPermissionRelay;
  let cachedCapabilities: Capabilities | null = loadCachedCapabilities();
  const wsPath = buildUrl(serverConfig.basePath, "/ws");
  const ptyPermApiPath = buildUrl(serverConfig.basePath, "/api/pty-permission");
  const ptyResponseApiPath = buildUrl(serverConfig.basePath, "/api/pty-response");

  // PTY permission relay — shared instance; sendToClient is wired per active WS connection
  // wsRef holds the current active WebSocket so the relay can push permission_request to client
  // eslint-disable-next-line prefer-const
  let wsRef: any = null;
  const ptyRelay = createPtyPermissionRelay((sessionId, requestId, tool) => {
    if (wsRef) {
      // Use sessionId as the event's sessionId; push permission_request to client
      const eventId = eventBuffer.append(sessionId, {
        type: "permission_request",
        sessionId,
        requestId,
        tool,
      });
      wsRef.send({
        type: "event",
        eventId,
        sessionId,
        payload: { type: "permission_request", sessionId, requestId, tool },
      });
    }
  });

  // Persistent state across reconnects
  const eventBuffer = new EventBuffer(500);
  const persistentState = {
    permissionHandler: null as PermissionHandler | null,
    pausedPermissions: [] as PendingPermissionSnapshot[],
    pausedPtyPermissions: [] as PtyRelaySnapshot[],
    pausedTmuxPermissions: [] as PtyRelaySnapshot[],
  };

  // Helper to send buffered messages
  function sendBuffered(ws: any, sessionId: string, message: Record<string, unknown>) {
    // Append to the buffer FIRST so the event survives a dead/mid-close socket:
    // a reconnecting client recovers it via per-session replay even if the live
    // ws.send below fails.
    const eventId = eventBuffer.append(sessionId, message);
    try {
      ws.send({ type: "event", eventId, sessionId, payload: message });
    } catch {
      // Socket is mid-close/dead (transient reconnect). Event is already buffered.
    }
  }

  // PTY response relay + HTTP handler — Stop hook delivers the assistant reply here,
  // resolving the in-flight drive() (ADR-011 readback for claude v2.1.177).
  const ptyResponseRelay = createPtyResponseRelay();
  const ptyResponseHttpHandler = createPtyResponseHandler({ relay: ptyResponseRelay });

  // C-hybrid TmuxRegistry (minimal WS seam only; reuses pty-response-relay/endpoint verbatim via URLs).
  // Created here so hooks always target the live server port+basePath. No changes to SessionManager/PtyOrchestrator.
  const tmuxResponseApiPath = buildUrl(serverConfig.basePath, "/api/pty-response");
  const tmuxResponseUrl = `http://127.0.0.1:${serverConfig.port}${tmuxResponseApiPath}`;
  const tmuxPermApiPath = buildUrl(serverConfig.basePath, "/api/pty-permission");
  const tmuxPermissionUrl = `http://127.0.0.1:${serverConfig.port}${tmuxPermApiPath}`;
  const tmuxRegistry = makeTmuxRegistry({
    responseUrl: tmuxResponseUrl,
    permissionUrl: tmuxPermissionUrl,
  });

  // PTY orchestrator — per-session --settings injection (ADR-014) reuses the same
  // loopback hook URLs as tmux, so PTY readback/permissions no longer depend on the
  // global ~/.claude/settings.json (fixes new-session hang when global Stop hook is altered).
  const ptyOrchestrator = new PtyOrchestrator({
    settings: { responseUrl: tmuxResponseUrl, permissionUrl: tmuxPermissionUrl },
  });

  // DP-1: on process shutdown, kill every cc-mobile-owned tmux session + unlink its settings.
  // Idempotent registration: a module-level flag prevents duplicate listeners if this plugin
  // is constructed more than once in the same process (e.g. tests).
  if (!tmuxShutdownHandlersRegistered) {
    tmuxShutdownHandlersRegistered = true;
    const onShutdown = () => {
      void tmuxRegistry.teardownAll();
    };
    process.on("SIGTERM", onShutdown);
    process.on("SIGINT", onShutdown);
  }

  // Independent tmux send routing (sink map) + response uses the shared ptyResponseRelay (arm/resolve)
  // per DP-2; pty path untouched.
  const tmuxSendRouting = createTmuxSendRouting({
    responseRelay: ptyResponseRelay,
  });

  // Independent tmux permission relay instance; sendToClient uses the claudeUuid->sink map
  // so permission_request only reaches originating client (E5: ptyRelay/wsRef left as-is).
  const tmuxPermissionRelay = makeTmuxPermissionRelay(
    (sessionId, requestId, tool) => {
      const sink = tmuxSendRouting.getClient(sessionId);
      if (sink) {
        // sink is the sendBuffered wrapper, which already does eventBuffer.append + ws.send.
        // Appending here too would double-append (replay would re-send the prompt).
        sink({
          type: "permission_request",
          sessionId,
          requestId,
          tool,
        });
      }
    },
    { timeoutMs: 90000 }, // tunable: unattended tmux permission TTL (90s vs relay default 600s)
  );

  // Re-create perm handler with shim relay that routes to tmuxRelay for tmux sessions (hasSession also or'd)
  // Original ptyPermissionHttpHandler creation moved down to here (was early) to access tmux*.
  const ptyPermissionHttpHandler = createPtyPermissionHandler({
    relay: {
      requestPtyPermission: (params: any) => {
        if (tmuxRegistry.hasSession(params.sessionId).present) {
          return tmuxPermissionRelay.requestPtyPermission(params);
        }
        return ptyRelay.requestPtyPermission(params);
      },
    } as any,
    hasSession: (sessionId: string) =>
      ptyOrchestrator.hasSession(sessionId) || tmuxRegistry.hasSession(sessionId).present,
  });

  return new Elysia()
    .post(ptyPermApiPath, ({ request }) => ptyPermissionHttpHandler(request))
    .post(ptyResponseApiPath, ({ request }) => ptyResponseHttpHandler(request))
    .ws(wsPath, {
      body: t.Any(), // We'll validate with Zod

      open(ws) {
        console.log("[ws] client connected");
        wsRef = ws;
        (ws.data as WsData).ptySessionIds = new Set<string>();

        // Create or reuse permission handler
        if (!persistentState.permissionHandler) {
          const handler = permissionBridgeFactory((requestId, tool) => {
            const sid = (ws.data as WsData).currentSessionId || "";
            sendBuffered(ws, sid, {
              type: "permission_request",
              sessionId: sid,
              requestId,
              tool,
            });
          });
          persistentState.permissionHandler = handler;
        } else {
          // Update existing handler to use new connection
          persistentState.permissionHandler.updateSendToClient((requestId, tool) => {
            const sid = (ws.data as WsData).currentSessionId || "";
            sendBuffered(ws, sid, {
              type: "permission_request",
              sessionId: sid,
              requestId,
              tool,
            });
          });
        }

        // Update all existing sessions to use this connection's permission handler
        sessionManager.updateCanUseTool(persistentState.permissionHandler.canUseTool);

        // Resume paused permissions if any
        if (persistentState.pausedPermissions.length > 0) {
          persistentState.permissionHandler.resumePending(persistentState.pausedPermissions);
          persistentState.pausedPermissions = [];
        }

        // Resume paused PTY permissions if any
        if (persistentState.pausedPtyPermissions.length > 0) {
          ptyRelay.resumePending(persistentState.pausedPtyPermissions);
          persistentState.pausedPtyPermissions = [];
        }

        // Send cached capabilities on reconnect
        emitCapabilitiesOnOpen(ws, cachedCapabilities);
      },

      async message(ws, data) {
        console.log("[ws] received:", (data as Record<string, unknown>)?.type ?? "unknown");

        // Minimal WS seam for tmux_create / tmux_teardown (C-hybrid).
        // These bypass ClientMessage (protocol.ts untouched per contract). Reuse pty-response etc via urls.
        const raw = data as Record<string, unknown>;
        if (raw.type === "tmux_create" || raw.type === "tmux_teardown") {
          try {
            if (raw.type === "tmux_create") {
              const claudeUuid = String(raw.claudeUuid ?? "");
              const rawCwd = String(raw.cwd ?? "");
              if (!claudeUuid || !rawCwd) {
                ws.send({
                  type: "error",
                  code: "invalid_tmux_create",
                  message: "claudeUuid and cwd required",
                });
                return;
              }
              const cwd = expandPath(rawCwd);
              const cwdError = validateCwd(cwd);
              if (cwdError) {
                ws.send({ type: "error", code: "invalid_cwd", message: cwdError });
                return;
              }
              if (!validateAllowedPath(cwd, serverConfig.allowedRoots)) {
                ws.send({
                  type: "error",
                  code: "path_not_allowed",
                  message: "Project path is not in the allowed roots",
                });
                return;
              }
              const info = await tmuxRegistry.createSession({ claudeUuid, cwd });
              ws.send({
                type: "tmux_created",
                claudeUuid,
                tmuxName: info.tmuxName,
                panePid: info.panePid,
              });
            } else if (raw.type === "tmux_teardown") {
              const claudeUuid = String(raw.claudeUuid ?? "");
              const result = await tmuxRegistry.teardown(claudeUuid);
              tmuxSendRouting.teardown(claudeUuid);
              ws.send({
                type: "tmux_teardown_result",
                claudeUuid,
                killed: result.killed,
              });
            }
          } catch (error) {
            ws.send({
              type: "error",
              code: "tmux_error",
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }

        const parsed = ClientMessage.safeParse(data);
        if (!parsed.success) {
          console.warn("[ws] invalid message:", parsed.error.message);
          ws.send({
            type: "error",
            code: "invalid_message",
            message: "Invalid message format",
          });
          return;
        }

        const message = parsed.data;
        if (!persistentState.permissionHandler) {
          ws.send({ type: "error", code: "internal_error", message: "No permission handler" });
          return;
        }
        const handler = persistentState.permissionHandler;

        try {
          switch (message.type) {
            case "new_session": {
              const cwd = expandPath(message.cwd);
              const cwdError = validateCwd(cwd);
              if (cwdError) {
                ws.send({
                  type: "error",
                  code: "invalid_cwd",
                  message: cwdError,
                });
                break;
              }

              if (!validateAllowedPath(cwd, serverConfig.allowedRoots)) {
                ws.send({
                  type: "error",
                  code: "path_not_allowed",
                  message: "Project path is not in the allowed roots",
                });
                break;
              }

              const sessionId = crypto.randomUUID();
              (ws.data as WsData).currentSessionId = sessionId;

              await sessionManager.createSession(
                sessionId,
                cwd,
                handler.canUseTool,
                undefined,
                message.title,
              );

              sendBuffered(ws, sessionId, {
                type: "session_created",
                sessionId,
                cwd,
              });
              break;
            }

            case "set_session_title": {
              try {
                await renameClaudeSession(message.sdkSessionId, message.title, message.dir);
              } catch (err) {
                ws.send({
                  type: "error",
                  code: "rename_failed",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
              break;
            }

            case "send":
            case "command": {
              // Track active session for permission routing
              (ws.data as WsData).currentSessionId = message.sessionId;
              const content =
                message.type === "send"
                  ? message.content // Can be string | ContentBlock[]
                  : message.command; // Always string for commands
              const generator = sessionManager.sendMessage(message.sessionId, content);

              for await (const sdkMessage of generator) {
                const msg = sdkMessage as Record<string, unknown>;

                // Extract and cache capabilities from system init message
                if (msg.type === "system" && msg.subtype === "init") {
                  // Fetch models + account info from SDK
                  const initData = await sessionManager.getInitData(message.sessionId);
                  cachedCapabilities = buildCachedCapabilities(msg, initData);
                  saveCachedCapabilities(cachedCapabilities);

                  emitCapabilitiesOnInit(sendBuffered, ws, message.sessionId, cachedCapabilities);
                }

                // Detect and forward session_state_changed as dedicated message
                if (msg.type === "system" && msg.subtype === "session_state_changed") {
                  const state = msg.state as string;
                  sendBuffered(ws, message.sessionId, {
                    type: "session_state",
                    sessionId: message.sessionId,
                    state,
                  });
                }

                sendBuffered(ws, message.sessionId, {
                  type: "stream_chunk",
                  sessionId: message.sessionId,
                  chunk: msg,
                });
              }

              sendBuffered(ws, message.sessionId, {
                type: "stream_end",
                sessionId: message.sessionId,
              });
              break;
            }

            case "append_user_message": {
              try {
                sessionManager.appendUserMessage(message.sessionId, message.content);
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                const code = errMsg.includes("not found")
                  ? "session_not_found"
                  : errMsg === "append_buffer_full"
                    ? "append_buffer_full"
                    : "append_failed";
                ws.send({
                  type: "error",
                  code,
                  message: errMsg,
                  sessionId: message.sessionId,
                });
              }
              break;
            }

            case "permission": {
              handler.resolvePermission(message.requestId, message.allow, message.answers);
              // Also resolve in PTY relay (idempotent if requestId unknown to it)
              ptyRelay.resolvePermission(message.requestId, message.allow, message.answers);
              break;
            }

            case "interrupt": {
              sessionManager.destroySession(message.sessionId);
              break;
            }

            case "get_server_config": {
              ws.send({
                type: "server_config",
                config: {
                  permissionMode: sessionManager.getPermissionMode(),
                  model: sessionManager.getSelectedModel(),
                  effort: sessionManager.getSelectedEffort(),
                  allowedRoots: serverConfig.allowedRoots,
                  homeDirectory: homedir(),
                },
              });
              break;
            }

            case "set_permission_mode": {
              if (message.sessionId) {
                if (!sessionManager.hasSession(message.sessionId)) {
                  ws.send({
                    type: "error",
                    code: "session_not_found",
                    message: `Session ${message.sessionId} not found`,
                    sessionId: message.sessionId,
                  });
                  break;
                }

                sessionManager.setSessionPermissionMode(message.sessionId, message.mode);
                ws.send({
                  type: "server_config",
                  config: {
                    permissionMode: message.mode,
                    sessionId: message.sessionId,
                  },
                });
                break;
              }

              sessionManager.setPermissionMode(message.mode);
              // Echo back updated config
              ws.send({
                type: "server_config",
                config: {
                  permissionMode: message.mode,
                },
              });
              break;
            }

            case "set_env_vars": {
              sessionManager.setEnvVars(message.envVars);
              break;
            }

            case "set_model": {
              await sessionManager.setModel(message.model, message.sessionId);
              ws.send({
                type: "server_config",
                config: {
                  model: sessionManager.getSelectedModel(),
                  effort: sessionManager.getSelectedEffort(),
                },
              });
              break;
            }

            case "set_effort": {
              sessionManager.setEffort(message.effort);
              ws.send({
                type: "server_config",
                config: {
                  effort: sessionManager.getSelectedEffort(),
                },
              });
              break;
            }

            case "list_sessions": {
              const sessions = await listClaudeSessions({
                dir: message.dir,
                limit: message.limit ?? 20,
                offset: message.offset ?? 0,
              });
              try {
                const validated = ServerMessage.parse({ type: "session_list", sessions });
                ws.send(validated);
              } catch (err) {
                console.error("[ws] session_list validation failed:", err);
                ws.send({ type: "session_list", sessions });
              }
              break;
            }

            case "get_session_info": {
              const session = await getClaudeSessionInfo(message.sessionId, message.dir);
              ws.send({ type: "session_info", session });
              break;
            }

            case "resume_session": {
              const cwd = expandPath(message.cwd);
              const cwdError = validateCwd(cwd);
              if (cwdError) {
                ws.send({
                  type: "error",
                  code: "invalid_cwd",
                  message: cwdError,
                });
                break;
              }

              if (!validateAllowedPath(cwd, serverConfig.allowedRoots)) {
                ws.send({
                  type: "error",
                  code: "path_not_allowed",
                  message: "Project path is not in the allowed roots",
                });
                break;
              }

              const sessionId = crypto.randomUUID();
              (ws.data as WsData).currentSessionId = sessionId;

              await sessionManager.createSession(
                sessionId,
                cwd,
                handler.canUseTool,
                message.sdkSessionId,
              );

              sendBuffered(ws, sessionId, {
                type: "session_created",
                sessionId,
                cwd,
              });

              // Load and send history
              try {
                const messages = await loadSessionHistory(message.sdkSessionId);
                const validated = ServerMessage.parse({
                  type: "session_history",
                  sessionId,
                  messages,
                });
                sendBuffered(ws, sessionId, validated);
              } catch (_err) {
                // Session created but history load failed - not fatal
                try {
                  const validated = ServerMessage.parse({
                    type: "session_history",
                    sessionId,
                    messages: [],
                  });
                  sendBuffered(ws, sessionId, validated);
                } catch {
                  sendBuffered(ws, sessionId, {
                    type: "session_history",
                    sessionId,
                    messages: [],
                  });
                }
              }

              // Send cached capabilities if available
              emitCapabilitiesOnResume(sendBuffered, ws, sessionId, cachedCapabilities);
              break;
            }

            case "list_directories": {
              const path = expandPath(message.path);

              // Validate path exists and is a directory
              const cwdError = validateCwd(path);
              if (cwdError) {
                ws.send({
                  type: "error",
                  code: "invalid_path",
                  message: cwdError,
                });
                break;
              }

              // Validate path is within allowed roots
              if (!validateAllowedPath(path, serverConfig.allowedRoots)) {
                ws.send({
                  type: "error",
                  code: "path_not_allowed",
                  message: "Path is not in the allowed roots",
                });
                break;
              }

              // List directories
              try {
                const entries = readdirSync(path, { withFileTypes: true });
                const directories: Array<{ name: string; path: string }> = [];

                for (const entry of entries) {
                  if (entry.isDirectory()) {
                    directories.push({
                      name: entry.name,
                      path: join(path, entry.name),
                    });
                  } else if (entry.isSymbolicLink()) {
                    // Resolve symlink and check if it points to a directory
                    try {
                      const entryPath = join(path, entry.name);
                      const resolvedPath = realpathSync(entryPath);
                      const stats = statSync(resolvedPath);

                      if (stats.isDirectory()) {
                        // Check if resolved path is within allowed roots
                        if (validateAllowedPath(resolvedPath, serverConfig.allowedRoots)) {
                          directories.push({
                            name: entry.name,
                            path: entryPath,
                          });
                        }
                      }
                    } catch {}
                  }
                }

                // Sort alphabetically
                directories.sort((a, b) => a.name.localeCompare(b.name));

                // Calculate parent
                const parent = path === sep ? null : dirname(path);

                ws.send({
                  type: "directory_listing",
                  path,
                  entries: directories,
                  parent,
                });
              } catch (err) {
                ws.send({
                  type: "error",
                  code: "permission_denied",
                  message: `Cannot read directory: ${path}`,
                });
              }
              break;
            }

            case "reconnect": {
              const { lastEventId, lastEventIds, sessionIds } = message;

              for (const sessionId of sessionIds) {
                // Per-session baseline (eventIds are per-session). Fall back to the
                // legacy global lastEventId only if no per-session cursor was sent.
                const perSession = lastEventIds?.[sessionId];
                const hasBaseline = perSession !== undefined || lastEventId !== null;
                const baseline = perSession ?? lastEventId ?? -1;
                const events = eventBuffer.replay(sessionId, baseline);
                const stats = eventBuffer.getStats(sessionId);
                const gapDetected = hasBaseline && stats.oldest !== null && baseline < stats.oldest;

                for (const evt of events) {
                  ws.send({
                    type: "event",
                    eventId: evt.eventId,
                    sessionId: evt.sessionId,
                    payload: evt.message,
                  });
                }

                ws.send({
                  type: "replay_complete",
                  sessionId,
                  eventsReplayed: events.length,
                  gapDetected,
                });
              }
              break;
            }

            case "tmux_send": {
              // TMUX happy-path (C-hybrid): use send-keys to inject prompt into owned tmux+claude session.
              // Arms one-per-turn waiter via shared response relay; delivers via independent sink map.
              // Does not touch PtyOrchestrator or SessionManager.
              const { claudeUuid, content } = message;
              // Register (or rebind) this ws as the owner for replies/perms for this claudeUuid
              tmuxSendRouting.registerClient(
                claudeUuid,
                (msg: Record<string, unknown>) => sendBuffered(ws, claudeUuid, msg),
                ws,
              );
              // Resume any tmux permission requests paused on the prior disconnect:
              // re-fires permission_request to the freshly-rebound sink (frozen-countdown).
              if (persistentState.pausedTmuxPermissions.length > 0) {
                tmuxPermissionRelay.resumePending(persistentState.pausedTmuxPermissions);
                persistentState.pausedTmuxPermissions = [];
              }
              await tmuxSendRouting.send({ claudeUuid, content });
              break;
            }

            case "pty_send": {
              // PTY happy-path: drive prompt via PTY, forward stream_chunk + stream_end to client.
              // Existing query() path is not touched. No permission handling (happy-path only).
              const { sessionId, cwd, prompt } = message;
              (ws.data as WsData).currentSessionId = sessionId;

              // H1 security: validate cwd before driving
              const cwdResult = resolveAndValidateCwd(cwd, serverConfig.allowedRoots);
              if (!cwdResult.ok) {
                ws.send({
                  type: "error",
                  code: cwdResult.error.code,
                  message: cwdResult.error.message,
                });
                break;
              }

              // Track sessionId before await so close() can cancel in-flight drives
              (ws.data as WsData).ptySessionIds ??= new Set<string>();
              (ws.data as WsData).ptySessionIds.add(sessionId);

              await ptyOrchestrator.drive(
                sessionId,
                cwdResult.path,
                prompt,
                (msg) => sendBuffered(ws, sessionId, msg as Record<string, unknown>),
                {
                  isPermissionPending: () => ptyRelay.hasPendingForSession(sessionId),
                  awaitResponseFn: (sid) => ptyResponseRelay.awaitResponse(sid),
                },
              );
              break;
            }
          }
        } catch (error) {
          console.error("[ws] error handling message:", error);
          ws.send({
            type: "error",
            code: "session_error",
            message: error instanceof Error ? error.message : String(error),
            sessionId:
              message.type !== "new_session" && "sessionId" in message
                ? message.sessionId
                : undefined,
          });
        }
      },

      close(ws) {
        // Pause pending permissions for potential reconnect
        if (persistentState.permissionHandler) {
          persistentState.pausedPermissions = persistentState.permissionHandler.pausePending();
        }
        persistentState.pausedPtyPermissions = ptyRelay.pausePending();
        persistentState.pausedTmuxPermissions = tmuxPermissionRelay.pausePending();

        // Do NOT cancel in-flight PTY drives on disconnect: a transient reconnect
        // would otherwise abort the turn and suppress its stream_end, leaving the
        // reconnected client's spinner stuck. Let the drive finish — it buffers
        // stream_chunk + stream_end (sendBuffered appends regardless of socket
        // state) so the reconnecting client recovers them via per-session replay,
        // and the drive self-cleans its PTY handle on resolve. Explicit user
        // interrupts still cancel via the interrupt path, not here.

        // Remove this connection's tmux uuid->sink bindings (baton map §cleanup).
        // Dead-binding leak prevention only; no rebind/replay to a new connection.
        tmuxSendRouting.cleanupByOwner(ws);

        wsRef = null;
        console.log("[ws] client disconnected");
      },
    });
}
