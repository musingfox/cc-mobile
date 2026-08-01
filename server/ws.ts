import { homedir } from "node:os";
import { Elysia, t } from "elysia";
import {
  type Capabilities,
  loadCachedCapabilities,
  saveCachedCapabilities,
} from "./capabilities-cache";
import type { ServerConfig } from "./config";
import { listDirectories } from "./directory-listing";
import type { EventBuffer } from "./event-buffer";
import {
  buildUrl,
  expandPath,
  resolveAndValidateCwd,
  validateAllowedPath,
  validateCwd,
} from "./path-utils";
import type { createPermissionHandler, PendingPermissionSnapshot } from "./permission-bridge";
import { ClientMessage, ServerMessage } from "./protocol";
import type { PtyOrchestrator } from "./pty-orchestrator";
import type { createPtyPermissionRelay, PtyRelaySnapshot } from "./pty-permission-relay";
import type { PtyResponseRelay } from "./pty-response-relay";
import { loadSessionHistory } from "./session-history";
import { getClaudeSessionInfo, listClaudeSessions, renameClaudeSession } from "./session-listing";
import type { InitData, SessionManager } from "./session-manager";
import { handleTmuxCreate, handleTmuxTeardown, type TmuxControlBackend } from "./tmux-control";

type PermissionHandlerFactory = typeof createPermissionHandler;
type PermissionHandler = ReturnType<PermissionHandlerFactory>;
type PtyPermissionRelay = ReturnType<typeof createPtyPermissionRelay>;

interface WsData {
  currentSessionId?: string;
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

/** The terminal backend surface the WS transport drives. */
export interface WsBackend extends TmuxControlBackend {
  /** claudeUuids with a live session — the authority a reconnecting client asks for. */
  listLive(): string[];
  send(params: { claudeUuid: string; content: string }): Promise<void>;
  registerClient(
    claudeUuid: string,
    sink: (msg: Record<string, unknown>) => void,
    owner?: unknown,
  ): void;
  cleanupByOwner(owner: unknown): void;
}

/**
 * Late-bound handle on the live socket, owned by the composition root. The
 * plugin points it at the current connection on open and nulls it on close, so
 * relays constructed before any client existed can still reach one.
 */
export interface ClientSink {
  current: ((msg: Record<string, unknown>) => void) | null;
}

/** Everything the transport needs but does not build. Assembled in app.ts. */
export interface WsCollaborators {
  backend: WsBackend;
  ptyOrchestrator: PtyOrchestrator;
  ptyRelay: PtyPermissionRelay;
  tmuxPermissionRelay: PtyPermissionRelay;
  ptyResponseRelay: PtyResponseRelay;
  eventBuffer: EventBuffer;
  clientSink: ClientSink;
}

export function createWsPlugin(
  sessionManager: SessionManager,
  permissionBridgeFactory: PermissionHandlerFactory,
  serverConfig: ServerConfig,
  collaborators: WsCollaborators,
) {
  const {
    backend,
    ptyOrchestrator,
    ptyRelay,
    tmuxPermissionRelay,
    ptyResponseRelay,
    eventBuffer,
    clientSink,
  } = collaborators;
  let cachedCapabilities: Capabilities | null = loadCachedCapabilities();
  const wsPath = buildUrl(serverConfig.basePath, "/ws");

  // Persistent state across reconnects
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

  return new Elysia().ws(wsPath, {
    body: t.Any(), // We'll validate with Zod

    open(ws) {
      console.log("[ws] client connected");
      clientSink.current = (msg) => ws.send(msg);

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

      // tmux session control needs no permission handler and owns its own error
      // mapping, so it dispatches ahead of the handler guard — as it did when
      // it was parsed by hand ahead of the Zod gate.
      if (message.type === "tmux_create") {
        await handleTmuxCreate(message, {
          backend,
          allowedRoots: serverConfig.allowedRoots,
          // The success ack is buffered so a client that blinked during the
          // create — readiness gating makes that a multi-second window — still
          // receives it on reconnect via replay. Errors stay bare: they carry
          // no session to key a buffer entry on, and the session they refer to
          // does not exist to replay for.
          send: (msg) =>
            msg.type === "tmux_created" ? sendBuffered(ws, message.claudeUuid, msg) : ws.send(msg),
        });
        return;
      }
      if (message.type === "tmux_teardown") {
        await handleTmuxTeardown(message, { backend, send: (msg) => ws.send(msg) });
        return;
      }

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

          case "stop_task": {
            await sessionManager.stopTask(message.sessionId, message.taskId, (code, errMsg) => {
              sendBuffered(ws, message.sessionId, {
                type: "error",
                code,
                message: errMsg,
                sessionId: message.sessionId,
              });
            });
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

          case "list_terminal_sessions": {
            // Bare send, not sendBuffered: this is a connection-scoped question
            // and its answer, not a session event. Buffering it would replay a
            // stale list to the next reconnect.
            ws.send({ type: "terminal_sessions", claudeUuids: backend.listLive() });
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
            const result = listDirectories(message.path, serverConfig.allowedRoots);
            if (!result.ok) {
              ws.send({
                type: "error",
                code: result.error.code,
                message: result.error.message,
              });
              break;
            }

            ws.send({ type: "directory_listing", ...result.listing });
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
            backend.registerClient(
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
            await backend.send({ claudeUuid, content });
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
      backend.cleanupByOwner(ws);

      clientSink.current = null;
      console.log("[ws] client disconnected");
    },
  });
}
