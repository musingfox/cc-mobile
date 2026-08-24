import { homedir } from "node:os";
import { Elysia, t } from "elysia";
import type { AuditLog, AuditRecordInput } from "./audit/audit-log";
import { captureClientIdentity } from "./audit/client-identity";
import { availableAgentKinds } from "./agents/kinds";
import type { ServerConfig } from "./config";
import { listDirectories } from "./directory-listing";
import type { EventBuffer } from "./event-buffer";
import { buildUrl } from "./path-utils";
import { ClientMessage } from "./protocol";
import type { SessionManager } from "./session-manager";
import {
  handleTerminalCreate,
  handleTerminalTeardown,
  type TerminalControlBackend,
} from "./terminal-control";
import type { PageCursor, TranscriptPage } from "./transcript/page";

/** The terminal backend surface the WS transport drives. */
export interface WsBackend extends TerminalControlBackend {
  /** claudeUuids with a session this process launched and still routes for. */
  listLive(): string[];
  /**
   * Every claude the daemon has, foreign ones included — the authority a
   * reconnecting client reconciles against. Optional: only a backend that can
   * enumerate the machine (herdr) has one, and its absence answers "none".
   */
  listSessionDescriptors?(): Promise<
    {
      sessionId: string;
      /** The kind herdr detected; absent when it has not detected one. */
      agent?: string;
      /** The pane's own title; absent when herdr reported none. */
      title?: string;
      agentSessionValue: string | null;
      cwd: string;
      origin: "self" | "foreign";
      drivable: boolean;
      readable: boolean;
      gated: boolean;
      state?: "idle" | "running" | "requires_action";
    }[]
  >;
  /**
   * Per-uuid agent state for the live sessions. Optional: only a backend with
   * a status source has any, and its absence costs the client its dot, not its
   * session list.
   */
  listStates?(): Promise<Record<string, "idle" | "running" | "requires_action">>;
  /**
   * Answers a screen-derived permission prompt by pressing a key in the pane,
   * after re-proving on live RPCs that the same prompt is still up. Resolves
   * `false` for an id it never issued — a silent no-op, so a stale sheet cannot
   * raise an error at the user. Optional: only a backend that can read a
   * terminal has one.
   */
  resolvePermission?(
    requestId: string,
    answer: { optionId?: string; allow?: boolean },
  ): Promise<boolean>;
  paneIdForRequest?(requestId: string): string | undefined;
  /**
   * One page of a session's own transcript backlog, older than `before`.
   * Resolves `null` when there is no transcript to read at all, which the
   * transport turns into `transcript_unavailable` rather than an empty page.
   * Optional: only a backend that can locate a pane's transcript has one, and
   * its absence answers "unavailable" for every session.
   */
  readTranscriptPage?(
    sessionId: string,
    before: PageCursor | null,
  ): Promise<TranscriptPage | null>;
  /**
   * The command / agent list for one live session. Optional: a backend without
   * a fetcher answers unsupported for every session, mirroring a missing
   * `readTranscriptPage` answering unavailable.
   */
  readCapabilities?(
    sessionId: string,
    options?: { refresh?: boolean },
  ): Promise<
    | { ok: true; commands: unknown[]; agents: unknown[] }
    | { ok: false; reason: "unsupported" | "failed" }
  >;
  /** Connection lifecycle for pending native prompts (see resolvePermission). */
  pausePermissions?(): void;
  resumePermissions?(): Promise<void> | void;
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
 * collaborators constructed before any client existed can still reach one.
 */
export interface ClientSink {
  current: ((msg: Record<string, unknown>) => void) | null;
}

/** Everything the transport needs but does not build. Assembled in app.ts. */
export interface WsCollaborators {
  backend: WsBackend;
  eventBuffer: EventBuffer;
  clientSink: ClientSink;
  auditLog?: AuditLog;
}

export function createWsPlugin(
  sessionManager: SessionManager,
  serverConfig: ServerConfig,
  collaborators: WsCollaborators,
) {
  const { backend, eventBuffer, clientSink, auditLog } = collaborators;
  const wsPath = buildUrl(serverConfig.basePath, "/ws");
  async function audit(record: AuditRecordInput): Promise<void> {
    try {
      await auditLog?.append(record);
    } catch {
      // 稽核失敗不能改變 WebSocket 主流程。
    }
  }

  /**
   * The connection's stable identity, used as the sink-ownership key.
   *
   * Elysia builds a FRESH `ElysiaWS` wrapper per callback — `message` and
   * `close` never receive the same object — so keying ownership on the wrapper
   * makes `cleanupByOwner` on close look up an owner that was never inserted:
   * it matches nothing and the owner map grows one dead entry per connection.
   * `ws.raw` is the single Bun socket the adapter carries into both callbacks.
   * The fallback keeps every connection distinct rather than collapsing them
   * onto one shared `undefined` key if a future adapter stops exposing `raw`.
   */
  function ownerOf(ws: { raw?: unknown }): unknown {
    return ws.raw ?? ws;
  }

  function identityOf(ws: {
    data?: { request?: Request };
    remoteAddress?: string;
  }): { ip: string | null; device: string | null } {
    const request = ws.data?.request;
    let deviceName: string | null = null;
    if (request) {
      try {
        deviceName = new URL(request.url).searchParams.get("device");
      } catch {
        // 無法解析 URL 時仍保留 socket 與 header 身分。
      }
    }
    return captureClientIdentity({
      headers: request?.headers,
      remoteAddress: ws.remoteAddress,
      deviceName,
    });
  }

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
          send: (msg) => {
            if (msg.type !== "terminal_created") {
              ws.send(msg);
              return;
            }
            // Bind the sink the moment the pane id exists, rather than waiting
            // for the first prompt. The pane is already live and its events are
            // already flowing, and transcript delivery advances its cursor
            // whether or not a sink is listening — so a turn settling in this
            // window would be read and dropped for good.
            const sessionId = msg.sessionId;
            if (typeof sessionId === "string" && sessionId.length > 0) {
              backend.registerClient(
                sessionId,
                (event: Record<string, unknown>) => sendBuffered(ws, sessionId, event),
                ownerOf(ws),
              );
            }
            // The buffer key stays the request uuid: the pane did not exist when
            // the client asked, so there is no pane-keyed cursor to write into
            // (Decision M15). The client re-keys its card on receipt.
            sendBuffered(ws, message.claudeUuid, msg);
          },
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

          // `answers` (the AskUserQuestion payload) is still accepted by the
          // schema so a cached bundle's message parses, but it is carried
          // nowhere: an answer is a keystroke in a pane now, and there is no
          // structured channel left to put typed text into.
          case "permission": {
            // Exactly one answer form is required. A discriminated union cannot
            // express that at the schema, so it is enforced here rather than
            // silently treating "no answer" as a denial.
            const paneId = backend.paneIdForRequest?.(message.requestId) ?? null;
            const identity = identityOf(ws);
            if (message.optionId === undefined && message.allow === undefined) {
              ws.send({
                type: "error",
                code: "invalid_message",
                message: "permission requires optionId or allow",
              });
              await audit({
                action: "permission_answer",
                paneId,
                ...identity,
                outcome: "rejected",
              });
              break;
            }

            // The backend presses the chosen key in the pane. An id it does
            // not know is a silent no-op, exactly as the deleted hook relay was:
            // a stale sheet answering a prompt that has already been dealt with
            // must not raise an error at the user.
            let outcome: "owned" | "unowned" | "failed";
            try {
              outcome = (await backend.resolvePermission?.(message.requestId, {
                ...(message.optionId !== undefined ? { optionId: message.optionId } : {}),
                ...(message.allow !== undefined ? { allow: message.allow } : {}),
              }))
                ? "owned"
                : "unowned";
            } catch {
              outcome = "failed";
            }
            await audit({
              action: "permission_answer",
              paneId,
              ...identity,
              outcome,
            });
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
            // Only what the server knows and the client cannot. An agent's
            // gating, model and effort are the agent's own settings: cc-mobile
            // neither sets them nor reports them here.
            ws.send({
              type: "server_config",
              config: {
                allowedRoots: serverConfig.allowedRoots,
                homeDirectory: homedir(),
                // Read per request rather than cached at boot: installing omp
                // while the server runs should show up on the next reload, not
                // require a restart (#31).
                availableAgents: availableAgentKinds(),
              },
            });
            break;
          }

          case "list_terminal_sessions": {
            // Bare send, not sendBuffered: this is a connection-scoped question
            // and its answer, not a session event. Buffering it would replay a
            // stale list to the next reconnect.
            // The list is the daemon's, not this process's memory: a session the
            // user started in their own terminal is listed exactly like one
            // cc-mobile launched (Decision H1), keyed by pane id (H5).
            // states is the status bootstrap: the subscription only fires on
            // change, so without it a reloaded client shows no activity until
            // something happens to move. A lookup failure degrades to {} rather
            // than withholding the liveness answer the reconcile depends on;
            // each descriptor also carries its own state.
            let sessions: NonNullable<
              Awaited<ReturnType<NonNullable<typeof backend.listSessionDescriptors>>>
            > = [];
            try {
              sessions = (await backend.listSessionDescriptors?.()) ?? [];
            } catch (error) {
              console.warn(
                `[ws] session listing unavailable: ${error instanceof Error ? error.message : String(error)}`,
              );
            }

            // Bind this socket as the sink for every session before replying:
            // until now a sink existed only after a terminal_send, so a
            // reconnecting client received no status events at all until it
            // sent a prompt. Same sink shape and same owner as terminal_send,
            // so the reply-recovery rules are unchanged — the binding is only
            // moved earlier. cleanupByOwner on close releases them.
            // Both keys are bound: the pane ids the client now reconciles on,
            // and the uuids the hook pipeline still routes replies and
            // permission prompts by until it is removed (Decision M7).
            const sinkKeys = new Set([
              ...sessions.map((session) => session.sessionId),
              ...backend.listLive(),
            ]);
            for (const sessionKey of sinkKeys) {
              backend.registerClient(
                sessionKey,
                (msg: Record<string, unknown>) => sendBuffered(ws, sessionKey, msg),
                ownerOf(ws),
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
              // Projected field by field: the backend's descriptor also carries
              // the workspace teardown needs, which is nobody's business on the
              // wire.
              sessions: sessions.map((session) => ({
                sessionId: session.sessionId,
                // Same rule as `state`: the key exists only when there is
                // something to say. An `agent: undefined` on the wire would
                // read as "detected nothing", which is a claim herdr did not
                // make.
                ...(session.agent ? { agent: session.agent } : {}),
                // Same rule as `agent`: omitted rather than sent undefined, so
                // "herdr has no title for this pane" stays distinguishable
                // from "this pane is called nothing".
                ...(session.title ? { title: session.title } : {}),
                agentSessionValue: session.agentSessionValue,
                cwd: session.cwd,
                origin: session.origin,
                drivable: session.drivable,
                readable: session.readable,
                gated: session.gated,
                ...(session.state ? { state: session.state } : {}),
              })),
              claudeUuids: sessions.map((session) => session.sessionId),
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
            const identity = identityOf(ws);
            // Register (or rebind) this ws as the owner for replies/perms for this claudeUuid
            backend.registerClient(
              claudeUuid,
              (msg: Record<string, unknown>) => sendBuffered(ws, claudeUuid, msg),
              ownerOf(ws),
            );
            // Any prompt still blocked from before the disconnect is re-read
            // from the live screen and re-raised to the freshly-rebound sink,
            // rather than replayed from a stored payload.
            try {
              await backend.resumePermissions?.();
              await backend.send({ claudeUuid, content });
              await audit({
                action: "prompt_send",
                paneId: claudeUuid,
                ...identity,
                outcome: "dispatched",
              });
            } catch (error) {
              await audit({
                action: "prompt_send",
                paneId: claudeUuid,
                ...identity,
                outcome: "failed",
              });
              throw error;
            }
            break;
          }

          case "capabilities_request": {
            const { sessionId, refresh } = message;
            // Catch here so a rejecting backend cannot fall into the generic
            // `session_error` wrapper — this answer is typed and session-named.
            let result: Awaited<ReturnType<NonNullable<WsBackend["readCapabilities"]>>>;
            try {
              result = backend.readCapabilities
                ? await backend.readCapabilities(
                    sessionId,
                    refresh ? { refresh: true } : undefined,
                  )
                : { ok: false, reason: "unsupported" };
            } catch {
              result = { ok: false, reason: "failed" };
            }
            if (!result.ok) {
              ws.send({
                type: "error",
                code:
                  result.reason === "unsupported"
                    ? "capabilities_unsupported"
                    : "capabilities_unavailable",
                sessionId,
              });
              break;
            }
            // Bare send, never `sendBuffered`: this answers one connection's
            // question, so it must not enter the session's replay buffer.
            ws.send({
              type: "capabilities_list",
              sessionId,
              commands: result.commands,
              agents: result.agents,
            });
            break;
          }

          case "transcript_page_request": {
            const { sessionId } = message;
            const page = await backend.readTranscriptPage?.(sessionId, message.before ?? null);
            // No transcript is not an empty page: the session may be foreign,
            // gone, or running a kind with no reader, and the client must be
            // able to tell that from "you have reached the beginning".
            if (!page) {
              ws.send({ type: "error", code: "transcript_unavailable", sessionId });
              break;
            }
            // Bare send, never `sendBuffered`: this answers one connection's
            // question, so it must not enter the session's replay buffer.
            ws.send({
              type: "transcript_page",
              sessionId,
              epoch: page.epoch,
              records: page.records,
              nextBefore: page.nextBefore,
            });
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
      // Pending permissions survive the gap: claude is blocked on its own
      // screen either way, and the prompt is re-read on reconnect.
      backend.pausePermissions?.();

      // Remove this connection's uuid->sink bindings (baton map §cleanup).
      // Dead-binding leak prevention only; no rebind/replay to a new connection.
      backend.cleanupByOwner(ownerOf(ws));

      clientSink.current = null;
      console.log("[ws] client disconnected");
    },
  });
}
