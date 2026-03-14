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
      // Store permission handler per connection
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
      const parsed = ClientMessage.safeParse(data);
      if (!parsed.success) {
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

          case "send": {
            const generator = sessionManager.sendMessage(
              message.sessionId,
              message.content
            );

            for await (const sdkMessage of generator) {
              // Send each chunk to client
              ws.send({
                type: "stream_chunk",
                sessionId: message.sessionId,
                chunk: sdkMessage as any,
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
      // Clean up any active sessions if needed
    },
  });
}
