import { Elysia, t } from "elysia";
import { homedir } from "os";
import { resolve, sep } from "path";
import { existsSync, statSync, realpathSync } from "fs";
import type { SessionManager } from "./session-manager";
import type { createPermissionHandler } from "./permission-bridge";
import type { ServerConfig } from "./config";
import { ClientMessage, ServerMessage } from "./protocol";
import { listClaudeSessions } from "./session-listing";
import { loadSessionHistory } from "./session-history";
import { loadCachedCapabilities, saveCachedCapabilities, type Capabilities } from "./capabilities-cache";

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
  const ensureTrailingSep = (p: string) => p.endsWith(sep) ? p : p + sep;

  for (const root of allowedRoots) {
    let normalizedRoot: string;
    try {
      normalizedRoot = realpathSync(root);
    } catch {
      normalizedRoot = resolve(root);
    }

    // Check if cwd is exactly the root or starts with root/
    if (normalizedCwd === normalizedRoot || normalizedCwd.startsWith(ensureTrailingSep(normalizedRoot))) {
      return true;
    }
  }

  return false;
}

type PermissionHandlerFactory = typeof createPermissionHandler;
type PermissionHandler = ReturnType<PermissionHandlerFactory>;

export function createWsPlugin(
  sessionManager: SessionManager,
  permissionBridgeFactory: PermissionHandlerFactory,
  serverConfig: ServerConfig
) {
  let cachedCapabilities: Capabilities | null = loadCachedCapabilities();

  return new Elysia().ws("/ws", {
    body: t.Any(), // We'll validate with Zod

    open(ws) {
      console.log("[ws] client connected");
      const handler = permissionBridgeFactory((requestId, tool) => {
        ws.send({
          type: "permission_request",
          sessionId: (ws.data as any).currentSessionId || "",
          requestId,
          tool,
        });
      });
      (ws.data as any).permissionHandler = handler;

      // Send cached capabilities on reconnect
      if (cachedCapabilities) {
        ws.send({
          type: "capabilities",
          ...cachedCapabilities,
        });
      }
    },

    async message(ws, data) {
      console.log("[ws] received:", (data as any)?.type ?? "unknown");
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
      const handler = (ws.data as any).permissionHandler as PermissionHandler;

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
            (ws.data as any).currentSessionId = sessionId;

            await sessionManager.createSession(
              sessionId,
              cwd,
              handler.canUseTool
            );

            ws.send({
              type: "session_created",
              sessionId,
              cwd,
            });
            break;
          }

          case "send":
          case "command": {
            const content = message.type === "send" ? message.content : message.command;
            const generator = sessionManager.sendMessage(
              message.sessionId,
              content
            );

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
                ws.send({
                  type: "capabilities",
                  sessionId: message.sessionId,
                  ...cachedCapabilities,
                });
              }

              ws.send({
                type: "stream_chunk",
                sessionId: message.sessionId,
                chunk: msg,
              });
            }

            ws.send({
              type: "stream_end",
              sessionId: message.sessionId,
            });
            break;
          }

          case "permission": {
            handler.resolvePermission(message.requestId, message.allow);
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
                permissionMode: serverConfig.permissionMode,
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
            (ws.data as any).currentSessionId = sessionId;

            await sessionManager.createSession(
              sessionId,
              cwd,
              handler.canUseTool,
              message.sdkSessionId
            );

            ws.send({
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
              ws.send(validated);
            } catch (err) {
              // Session created but history load failed - not fatal
              try {
                const validated = ServerMessage.parse({
                  type: "session_history",
                  sessionId,
                  messages: [],
                });
                ws.send(validated);
              } catch {
                ws.send({
                  type: "session_history",
                  sessionId,
                  messages: [],
                });
              }
            }

            // Send cached capabilities if available
            if (cachedCapabilities) {
              ws.send({
                type: "capabilities",
                sessionId,
                ...cachedCapabilities,
              });
            }
            break;
          }
        }
      } catch (error) {
        console.error("[ws] error handling message:", error);
        ws.send({
          type: "error",
          code: "session_error",
          message: error instanceof Error ? error.message : String(error),
          sessionId: message.type !== "new_session" && "sessionId" in message
            ? message.sessionId
            : undefined,
        });
      }
    },

    close(ws) {
      console.log("[ws] client disconnected");
    },
  });
}
