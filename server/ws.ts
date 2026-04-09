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
import { HeartbeatManager } from "./heartbeat";
import { buildUrl } from "./path-utils";
import type { createPermissionHandler, PendingPermissionSnapshot } from "./permission-bridge";
import { ClientMessage, ServerMessage } from "./protocol";
import { loadSessionHistory } from "./session-history";
import { getClaudeSessionInfo, listClaudeSessions } from "./session-listing";
import type { SessionManager } from "./session-manager";

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
  heartbeat?: HeartbeatManager;
}

export function createWsPlugin(
  sessionManager: SessionManager,
  permissionBridgeFactory: PermissionHandlerFactory,
  serverConfig: ServerConfig,
) {
  let cachedCapabilities: Capabilities | null = loadCachedCapabilities();
  const wsPath = buildUrl(serverConfig.basePath, "/ws");

  // Persistent state across reconnects
  const eventBuffer = new EventBuffer(500);
  const persistentState = {
    permissionHandler: null as PermissionHandler | null,
    pausedPermissions: [] as PendingPermissionSnapshot[],
  };

  // Helper to send buffered messages
  function sendBuffered(ws: any, sessionId: string, message: Record<string, unknown>) {
    const eventId = eventBuffer.append(sessionId, message);
    ws.send({ type: "event", eventId, sessionId, payload: message });
  }

  return new Elysia().ws(wsPath, {
    body: t.Any(), // We'll validate with Zod

    open(ws) {
      console.log("[ws] client connected");

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

      // Start heartbeat
      const heartbeat = new HeartbeatManager(ws);
      (ws.data as WsData).heartbeat = heartbeat;
      heartbeat.start();

      // Send cached capabilities on reconnect
      if (cachedCapabilities) {
        ws.send({
          type: "capabilities",
          ...cachedCapabilities,
        });
      }
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
      const wsData = ws.data as WsData;
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

            await sessionManager.createSession(sessionId, cwd, handler.canUseTool);

            sendBuffered(ws, sessionId, {
              type: "session_created",
              sessionId,
              cwd,
            });
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
                cachedCapabilities = {
                  commands: (msg.slash_commands as string[]) || [],
                  agents: (msg.agents as string[]) || [],
                  model: (msg.model as string) || "unknown",
                };
                saveCachedCapabilities(cachedCapabilities);

                // Fetch models + account info from SDK
                const initData = await sessionManager.getInitData(message.sessionId);

                sendBuffered(ws, message.sessionId, {
                  type: "capabilities",
                  sessionId: message.sessionId,
                  ...cachedCapabilities,
                  ...(initData ? { models: initData.models, accountInfo: initData.account } : {}),
                });
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

          case "permission": {
            handler.resolvePermission(message.requestId, message.allow, message.answers);
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
            if (cachedCapabilities) {
              sendBuffered(ws, sessionId, {
                type: "capabilities",
                sessionId,
                ...cachedCapabilities,
              });
            }
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
            const { lastEventId, sessionIds } = message;

            for (const sessionId of sessionIds) {
              const events = eventBuffer.replay(sessionId, lastEventId ?? -1);
              const stats = eventBuffer.getStats(sessionId);
              const gapDetected =
                lastEventId !== null && stats.oldest !== null && lastEventId < stats.oldest;

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

          case "pong": {
            wsData.heartbeat?.recordPong();
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
      const wsData = ws.data as WsData;

      // Stop heartbeat
      wsData.heartbeat?.stop();

      // Pause pending permissions for potential reconnect
      if (persistentState.permissionHandler) {
        persistentState.pausedPermissions = persistentState.permissionHandler.pausePending();
      }

      console.log("[ws] client disconnected");
    },
  });
}
