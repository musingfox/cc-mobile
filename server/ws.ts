import { Elysia, t } from "elysia";
import type { SessionManager } from "./session-manager";
import type { createPermissionHandler } from "./permission-bridge";
import { ClientMessage, ServerMessage } from "./protocol";

type PermissionHandlerFactory = typeof createPermissionHandler;
type PermissionHandler = ReturnType<PermissionHandlerFactory>;

export function createWsPlugin(
  sessionManager: SessionManager,
  permissionBridgeFactory: PermissionHandlerFactory
) {
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
            const sessionId = crypto.randomUUID();
            (ws.data as any).currentSessionId = sessionId;

            await sessionManager.createSession(
              sessionId,
              message.cwd,
              handler.canUseTool
            );

            ws.send({
              type: "session_created",
              sessionId,
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

              // Extract capabilities from system init message
              if (msg.type === "system" && msg.subtype === "init") {
                ws.send({
                  type: "capabilities",
                  sessionId: message.sessionId,
                  commands: (msg.slash_commands as string[]) || [],
                  agents: (msg.agents as string[]) || [],
                  model: (msg.model as string) || "unknown",
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
