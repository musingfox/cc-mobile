import { homedir } from "node:os";
import { Elysia, t } from "elysia";
import { type Capabilities, loadCachedCapabilities } from "./capabilities-cache";
import type { ServerConfig } from "./config";
import { listDirectories } from "./directory-listing";
import type { EventBuffer } from "./event-buffer";
import { buildUrl } from "./path-utils";
import { ClientMessage } from "./protocol";
import type { createPtyPermissionRelay, PtyRelaySnapshot } from "./pty-permission-relay";
import type { SessionManager } from "./session-manager";
import {
  handleTerminalCreate,
  handleTerminalTeardown,
  type TerminalControlBackend,
} from "./terminal-control";

type PtyPermissionRelay = ReturnType<typeof createPtyPermissionRelay>;

// ---------------------------------------------------------------------------
// Capabilities emit helper — extracted seam (logic-free; byte-equivalent)
//
// TODO(#26): the disk cache this reads has had no writer since the SDK query
// path was removed, so the slash-command / agent lists are frozen at whatever
// a pre-#25 run left behind (empty on a machine that never had one).
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

/** The terminal backend surface the WS transport drives. */
export interface WsBackend extends TerminalControlBackend {
  /** claudeUuids with a live session — the authority a reconnecting client asks for. */
  listLive(): string[];
  /**
   * claudeUuids the startup remount skipped — possibly alive but not routable.
   * Optional: only a backend that remounts (herdr) can have any.
   */
  listUnknown?(): string[];
  /**
   * Per-uuid agent state for the live sessions. Optional: only a backend with
   * a status source has any, and its absence costs the client its dot, not its
   * session list.
   */
  listStates?(): Promise<Record<string, "idle" | "running" | "requires_action">>;
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
  terminalPermissionRelay: PtyPermissionRelay;
  eventBuffer: EventBuffer;
  clientSink: ClientSink;
}

export function createWsPlugin(
  sessionManager: SessionManager,
  serverConfig: ServerConfig,
  collaborators: WsCollaborators,
) {
  const { backend, terminalPermissionRelay, eventBuffer, clientSink } = collaborators;
  const cachedCapabilities: Capabilities | null = loadCachedCapabilities();
  const wsPath = buildUrl(serverConfig.basePath, "/ws");

  // Persistent state across reconnects
  const persistentState = {
    pausedTerminalPermissions: [] as PtyRelaySnapshot[],
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

      // Terminal session control owns its own error mapping and reply shapes,
      // so it dispatches ahead of the main switch rather than inside it.
      if (message.type === "terminal_create") {
        await handleTerminalCreate(message, {
          backend,
          allowedRoots: serverConfig.allowedRoots,
          // The success ack is buffered so a client that blinked during the
          // create — readiness gating makes that a multi-second window — still
          // receives it on reconnect via replay. Errors stay bare: they carry
          // no session to key a buffer entry on, and the session they refer to
          // does not exist to replay for.
          send: (msg) =>
            msg.type === "terminal_created"
              ? sendBuffered(ws, message.claudeUuid, msg)
              : ws.send(msg),
        });
        return;
      }
      if (message.type === "terminal_teardown") {
        await handleTerminalTeardown(message, { backend, send: (msg) => ws.send(msg) });
        return;
      }

      try {
        switch (message.type) {
          // TODO(#25-followup, #26): the append buffer this fills has no
          // consumer — the SDK turn driver that used to drain it is gone. And
          // with the last session-registering handler deleted in #26, the
          // manager's map is permanently empty, so this now always answers
          // `session_not_found`. Accepted rather than rejected at the schema so
          // the client method does not start throwing.
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
            // The herdr relay is the only holder of in-flight permission
            // requests; resolving an unknown requestId is a silent no-op.
            terminalPermissionRelay.resolvePermission(
              message.requestId,
              message.allow,
              message.answers,
            );
            break;
          }

          // TODO(#25-followup, #26): the session map is permanently empty, so
          // this deletes nothing and stays silent — no frame of any kind.
          case "interrupt": {
            sessionManager.destroySession(message.sessionId);
            break;
          }

          // TODO(#25-followup, #26): there is no in-process turn to stop any more, so
          // this always answers `no_active_query`. The UI's stop button stays
          // wired but inert until herdr exposes a per-task interrupt.
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

          // TODO(#25-followup, #26): set_permission_mode / set_env_vars /
          // set_model / set_effort record state and echo it back, but herdr
          // receives none of it — the pane's mode comes from the argv app.ts
          // built at startup. Since #26 emptied the session map for good, the
          // per-session branch below always answers `session_not_found`; only
          // the global branch still records anything. These stay accepted
          // (rather than rejected) so the settings UI does not error at the
          // user; making the UI honest is a separate ticket.
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
            sessionManager.setModel(message.model);
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

          case "list_terminal_sessions": {
            // Bare send, not sendBuffered: this is a connection-scoped question
            // and its answer, not a session event. Buffering it would replay a
            // stale list to the next reconnect.
            // unknownUuids carries the remount's conservatism to the client: a
            // skipped session is "leave the card alone", not "dead, delete it".
            // states is the status bootstrap: the subscription only fires on
            // change, so without it a reloaded client shows no activity until
            // something happens to move. A lookup failure degrades to {} rather
            // than withholding the liveness answer the reconcile depends on.
            //
            // Bind this socket as the sink for every live uuid before replying:
            // until now a sink existed only after a terminal_send, so a
            // reconnecting client received no status events at all until it
            // sent a prompt. Same sink shape and same owner as terminal_send,
            // so the reply-recovery rules are unchanged — the binding is only
            // moved earlier. cleanupByOwner(ws) on close releases them.
            for (const claudeUuid of backend.listLive()) {
              backend.registerClient(
                claudeUuid,
                (msg: Record<string, unknown>) => sendBuffered(ws, claudeUuid, msg),
                ws,
              );
            }

            let states: Record<string, "idle" | "running" | "requires_action"> = {};
            try {
              states = (await backend.listStates?.()) ?? {};
            } catch (error) {
              console.warn(
                `[ws] agent states unavailable: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
            ws.send({
              type: "terminal_sessions",
              claudeUuids: backend.listLive(),
              unknownUuids: backend.listUnknown?.() ?? [],
              states,
            });
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

          case "terminal_send": {
            // Terminal happy-path (C-hybrid): inject the prompt into the owned pane's claude.
            // Arms one-per-turn waiter via shared response relay; delivers via independent sink map.
            // Does not touch SessionManager.
            const { claudeUuid, content } = message;
            // Register (or rebind) this ws as the owner for replies/perms for this claudeUuid
            backend.registerClient(
              claudeUuid,
              (msg: Record<string, unknown>) => sendBuffered(ws, claudeUuid, msg),
              ws,
            );
            // Resume any terminal permission requests paused on the prior disconnect:
            // re-fires permission_request to the freshly-rebound sink (frozen-countdown).
            if (persistentState.pausedTerminalPermissions.length > 0) {
              terminalPermissionRelay.resumePending(persistentState.pausedTerminalPermissions);
              persistentState.pausedTerminalPermissions = [];
            }
            await backend.send({ claudeUuid, content });
            break;
          }
        }
      } catch (error) {
        console.error("[ws] error handling message:", error);
        ws.send({
          type: "error",
          code: "session_error",
          message: error instanceof Error ? error.message : String(error),
          sessionId: "sessionId" in message ? message.sessionId : undefined,
        });
      }
    },

    close(ws) {
      // Pause pending permissions for potential reconnect
      persistentState.pausedTerminalPermissions = terminalPermissionRelay.pausePending();

      // Remove this connection's uuid->sink bindings (baton map §cleanup).
      // Dead-binding leak prevention only; no rebind/replay to a new connection.
      backend.cleanupByOwner(ws);

      clientSink.current = null;
      console.log("[ws] client disconnected");
    },
  });
}
