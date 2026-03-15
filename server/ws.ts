import { Elysia, t } from "elysia";
import { homedir } from "os";
import { resolve } from "path";
import { existsSync, statSync } from "fs";
import type { SessionManager } from "./session-manager";
import type { createPermissionHandler } from "./permission-bridge";
import type { ServerConfig } from "./config";
import { ClientMessage, ServerMessage } from "./protocol";
import { listClaudeSessions } from "./session-listing";
import { loadSessionHistory } from "./session-history";

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

type PermissionHandlerFactory = typeof createPermissionHandler;
type PermissionHandler = ReturnType<PermissionHandlerFactory>;

export function createWsPlugin(
  sessionManager: SessionManager,
  permissionBridgeFactory: PermissionHandlerFactory,
  serverConfig: ServerConfig
) {
  let cachedCapabilities: {
    commands: string[];
    agents: string[];
    model: string;
  } | null = null;

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
            ws.send({ type: "session_list", sessions });
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
              ws.send({
                type: "session_history",
                sessionId,
                messages,
              });
            } catch (err) {
              // Session created but history load failed - not fatal
              ws.send({
                type: "session_history",
                sessionId,
                messages: [],
              });
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
