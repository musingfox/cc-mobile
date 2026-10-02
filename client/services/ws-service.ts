import type { PromptKind } from "../../server/protocol";
import { debugLog } from "../components/DebugOverlay";
import {
  type AgentInfo,
  type AgentProfile,
  type CommandInfo,
  type Message,
  type PendingPermission,
  type PermissionOption,
  type TranscriptCursor,
  useAppStore,
} from "../stores/app-store";
import { useSettingsStore } from "../stores/settings-store";
import { randomUuid } from "../utils/uuid";
import { hapticService } from "./haptic";
import { notificationService } from "./notification";
import { saveProject } from "./projects";
import { describeServerError } from "./server-error-text";
import { toastService } from "./toast-service";
import { messagesFromProjectedChunk } from "./transcript-projection";

/** Server probe budget is 30s; 45s is that ceiling plus margin for a dropped reply. */
export const CAPABILITIES_REQUEST_TIMEOUT_MS = 45_000;

/**
 * How long after a send an inbound `user` record may still be that send's echo.
 * Measured on this device's clock, never against the record's own timestamp:
 * the phone and the dev machine are two clocks, and a skew of minutes would
 * silently stop the pairing without anything looking wrong.
 */
const ECHO_PAIRING_WINDOW_MS = 300_000;

/**
 * The record's identity and position, as the server stamped them. Both are
 * omitted rather than set to `undefined` when the chunk carries neither: a
 * message with no `recordId` is by definition local-only, and that has to stay
 * distinguishable from one whose id happened to be undefined.
 */
function transcriptPositionOf(chunk: Record<string, unknown>): { recordId?: string; seq?: number } {
  return {
    ...(typeof chunk.recordId === "string" ? { recordId: chunk.recordId } : {}),
    ...(typeof chunk.seq === "number" ? { seq: chunk.seq } : {}),
  };
}

/** The file this chunk came from, or null when it makes no claim. */
function epochOfChunk(chunk: Record<string, unknown>): string | null {
  return typeof chunk.epoch === "string" && chunk.epoch !== "" ? chunk.epoch : null;
}

/**
 * How a resolved prompt is written into the session's history.
 *
 * A question has no approve/deny axis — "B" is neither — so only an explicit
 * Cancel reads as a refusal there and every other choice is the answer given.
 * A permission prompt keeps the label test it has always used.
 */
export function permissionResolution(
  pending: { promptKind?: PromptKind; options?: PermissionOption[] },
  optionId: string,
): "approved" | "denied" | "answered" {
  const cancelled = optionId === "cancel";
  if (pending.promptKind === "question") return cancelled ? "denied" : "answered";
  const option = pending.options?.find((entry) => entry.id === optionId);
  return cancelled || /^no\b/i.test(option?.label ?? "") ? "denied" : "approved";
}

export { extractTextFromChunk } from "./transcript-projection";

/**
 * The card's own view of a `permission_request` frame.
 *
 * `promptKind` rides along only when the server claimed one of its two known
 * values: a frame without the key is an unparsed screen, which is an ordinary
 * state and not an error, and an unrecognised value is treated the same way
 * rather than passed through to the card.
 */
export function pendingFromPermissionRequest(msg: Record<string, unknown>): PendingPermission {
  // The options are the terminal's own, parsed off its screen — never
  // synthesised here. An empty list means the screen was unreadable and the
  // sheet offers Cancel only.
  const options = Array.isArray(msg.options) ? (msg.options as PermissionOption[]) : [];
  // Narrowed against the two literals rather than against `PromptKindSchema`
  // itself: importing the schema as a value pulls zod into the phone's bundle
  // (measured: +60 KB, and `ZodError` appears in the built assets where it is
  // absent today). The type still comes from the schema, so a third value here
  // would not compile.
  const kind = msg.promptKind as PromptKind | undefined;
  return {
    requestId: msg.requestId as string,
    tool: msg.tool as {
      name: string;
      parameters: Record<string, unknown>;
    },
    options,
    ...(kind === "permission" || kind === "question" ? { promptKind: kind } : {}),
  };
}

export function buildWsUrl(
  protocol: "ws:" | "wss:",
  host: string,
  basePath: string,
  deviceName: string,
): string {
  const name = deviceName.trim();
  const query = name ? `?device=${encodeURIComponent(name)}` : "";
  return `${protocol}//${host}${basePath}/ws${query}`;
}

/**
 * How often a visible page repeats its `visibility` report. The server stops
 * believing a `visible` after `FOREGROUND_FRESH_MS` (server/push/foreground.ts)
 * because a locking phone may never send `hidden`; this stays well under that,
 * so one lost repeat does not let a push through to a phone in a hand.
 */
export const VISIBILITY_HEARTBEAT_MS = 10_000;

class WsService {
  private ws: WebSocket | null = null;
  private capabilitiesTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectTimeout: number | null = null;
  private reconnectDelay = 1000;
  // Per-session replay cursor. eventIds are assigned per-session by the server
  // (starting at 1), so a single global cursor would mis-baseline replay across
  // sessions and silently drop missed events on reconnect (→ stuck spinner).
  private lastEventIds = new Map<string, number>();
  private disconnectBannerTimeout: number | null = null;
  // Terminal sessions awaiting their `terminal_created` reply. Create failures come
  // back without a claudeUuid, so a failure clears every pending optimistic
  // session rather than guessing which one it belongs to.
  private pendingTerminalCreates = new Set<string>();
  // The prompt each session last handed to the server, with the id of the
  // optimistic bubble it drew for it. A refusal (`session_busy`) is the one
  // reply that means the turn never happened: the bubble has to come back off
  // the screen and the text has to go back in the composer, or the user loses
  // what they typed to a send that was never made.
  private lastOptimisticSend = new Map<
    string,
    Array<{ messageId: string; prompt: string; sentAt: number }>
  >();

  /** Prompt cards on screen when this socket opened: sessionId → requestId. */
  private cardsAtOpen = new Map<string, string>();

  private sendMessage(msg: Record<string, unknown>) {
    if (!this.ws) return;
    debugLog.add("send", msg);
    this.ws.send(JSON.stringify(msg));
  }

  private reportVisibility() {
    this.sendMessage({
      type: "visibility",
      state: document.visibilityState === "visible" ? "visible" : "hidden",
    });
  }

  private rememberCardsAtOpen() {
    this.cardsAtOpen = new Map();
    for (const [id, session] of useAppStore.getState().sessions) {
      if (session.pendingPermission) this.cardsAtOpen.set(id, session.pendingPermission.requestId);
    }
  }

  private clearCard(sessionId: string) {
    const store = useAppStore.getState();
    if (store.sessions.get(sessionId)?.pendingPermission) store.setPermission(sessionId, null);
  }

  connect() {
    const store = useAppStore.getState();
    store.setConnectionState("connecting");

    // Restore per-session lastEventIds from localStorage
    try {
      if (this.lastEventIds.size === 0) {
        const stored = localStorage.getItem("ccm:lastEventIds");
        if (stored) {
          const obj = JSON.parse(stored) as Record<string, number>;
          for (const [sid, id] of Object.entries(obj)) {
            if (typeof id === "number") this.lastEventIds.set(sid, id);
          }
        }
      }
    } catch {}

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const basePath = (window as typeof window & { __BASE_PATH__?: string }).__BASE_PATH__ || "";
    const ws = new WebSocket(
      buildWsUrl(protocol, window.location.host, basePath, useSettingsStore.getState().deviceName),
    );

    // Bound to this socket: a socket that is no longer current reports nothing,
    // so a slow close of an old one cannot speak over the new one.
    const reportIfCurrent = () => {
      if (this.ws === ws) this.reportVisibility();
    };
    let visibilityHeartbeat: number | null = null;

    ws.onopen = () => {
      console.log("[ws-service] connected");
      // Cancel pending disconnect banner — reconnect was fast enough
      if (this.disconnectBannerTimeout !== null) {
        clearTimeout(this.disconnectBannerTimeout);
        this.disconnectBannerTimeout = null;
      }
      const store = useAppStore.getState();
      store.setConnectionState("connected");
      this.reconnectDelay = 1000;
      this.ws = ws;
      this.rememberCardsAtOpen();
      // Which paths are allowed, and which agents this machine can launch.
      // Nothing is pushed the other way any more: an agent's model, effort and
      // gating are its own settings, not cc-mobile's to restore.
      this.sendMessage({ type: "get_server_config" });

      // Send reconnect with per-session cursors so the server replays the events
      // missed during the drop for EACH session independently (eventIds are
      // per-session). Without this, a global cursor drops missed events → spinner
      // stuck forever after a flaky reconnect.
      const sessionIds = Array.from(useAppStore.getState().sessions.keys());
      if (sessionIds.length > 0) {
        this.sendMessage({
          type: "reconnect",
          lastEventId: null,
          lastEventIds: Object.fromEntries(this.lastEventIds),
          sessionIds,
        });
      }

      // Always ask for the live terminal sessions: the server's list is the
      // authority that flips restored cards back to ready and drops the dead
      // ones. Sent unconditionally — an empty local list still needs the answer
      // (localStorage may have been cleared while sessions kept running).
      this.sendMessage({ type: "list_terminal_sessions" });

      // If we have restored sessions, don't auto-create a new one
      // User already has sessions from persistence
      if (store.sessions.size === 0) {
        // No restored sessions - this is first load or clean state
        // Auto-create will happen via other mechanisms if needed
      }

      reportIfCurrent();
      document.addEventListener("visibilitychange", reportIfCurrent);
      visibilityHeartbeat = window.setInterval(() => {
        if (this.ws !== ws) {
          if (visibilityHeartbeat !== null) window.clearInterval(visibilityHeartbeat);
          return;
        }
        if (document.visibilityState === "visible") this.reportVisibility();
      }, VISIBILITY_HEARTBEAT_MS);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        debugLog.add("recv", msg);

        // Handle event envelope — unwrap and track per-session eventId
        if (msg.type === "event") {
          if (typeof msg.sessionId === "string" && typeof msg.eventId === "number") {
            this.lastEventIds.set(msg.sessionId, msg.eventId);
            // Persist per-session cursors across page reloads
            try {
              localStorage.setItem(
                "ccm:lastEventIds",
                JSON.stringify(Object.fromEntries(this.lastEventIds)),
              );
            } catch {}
          }
          this.handleMessage(msg.payload);
          return;
        }

        // Backward tolerance: stale servers may still send ping; ignore silently.
        if (msg.type === "ping") {
          return;
        }

        // Handle replay_complete
        if (msg.type === "replay_complete") {
          console.log(
            `[ws-service] replay complete: session=${msg.sessionId}, events=${msg.eventsReplayed}, gap=${msg.gapDetected}`,
          );
          if (msg.gapDetected) {
            toastService.info("Some messages may have been missed during reconnect");
          }
          return;
        }

        // All other messages (non-wrapped) go through handleMessage directly
        this.handleMessage(msg);
      } catch (err) {
        console.error("[ws-service] parse error:", err);
      }
    };

    ws.onerror = (error) => {
      console.error("[ws-service] error:", error);
    };

    ws.onclose = () => {
      console.log("[ws-service] disconnected");
      if (visibilityHeartbeat !== null) window.clearInterval(visibilityHeartbeat);
      document.removeEventListener("visibilitychange", reportIfCurrent);
      this.ws = null;
      // Delay showing disconnect banner — if reconnect is fast, user won't notice
      this.disconnectBannerTimeout = window.setTimeout(() => {
        useAppStore.getState().setConnectionState("disconnected");
        this.disconnectBannerTimeout = null;
      }, 3000);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    const delay = Math.min(this.reconnectDelay, 30000);
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectDelay = Math.min(delay * 2, 30000);
      this.connect();
    }, delay);
  }

  private handleMessage(msg: Record<string, unknown>) {
    const store = useAppStore.getState();
    const sessionId = msg.sessionId as string | undefined;

    switch (msg.type) {
      case "terminal_created": {
        const claudeUuid = msg.claudeUuid as string | undefined;
        if (!claudeUuid) break;
        const wasPending = this.pendingTerminalCreates.delete(claudeUuid);
        const cwd = store.sessions.get(claudeUuid)?.cwd;
        // The session key is herdr's pane id from here on; the request uuid was
        // only ever the buffer slot the ack landed in. Re-keying is idempotent,
        // so a replayed ack after a reconnect changes nothing.
        const serverId = (msg.sessionId as string | undefined) ?? claudeUuid;
        if (serverId !== claudeUuid) {
          store.rekeySession(claudeUuid, serverId);
          this.lastEventIds.delete(claudeUuid);
        }
        const sessionKey = serverId;
        store.setTerminalReady(sessionKey, true);
        // The create ack is the server speaking about this session: it exists,
        // and it is not running anything yet. Without this the session stays
        // unreconciled — and therefore dark on the Projects screen — until the
        // next reconnect or the first prompt, which points the opposite way
        // from what the user just did.
        //
        // Only for an ack this connection is actually waiting on. The ack is
        // buffered, so a reconnect replays it: re-applying "idle" then would
        // blank the spinner of a session that has since started running, which
        // is the same client-side-claim-beats-herdr bug in a smaller window.
        if (wasPending) store.setAgentState(sessionKey, "idle");
        if (cwd) saveProject(cwd);
        break;
      }

      case "terminal_sessions": {
        // Server-authoritative live list, keyed by herdr pane id. A malformed
        // payload must not tear down local state, so anything but an array of
        // descriptors is ignored entirely.
        if (!Array.isArray(msg.sessions)) break;
        const descriptors = (msg.sessions as Record<string, unknown>[]).filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === "object" && entry !== null && typeof entry.sessionId === "string",
        );
        const live = new Set(descriptors.map((entry) => entry.sessionId as string));

        // Every listed session gets a card, including ones the user started in
        // their own terminal and this browser has never seen — that is the
        // point of the global listing.
        for (const entry of descriptors) {
          const sessionId = entry.sessionId as string;
          store.upsertListedSession({
            sessionId,
            cwd: typeof entry.cwd === "string" ? entry.cwd : "",
            origin: entry.origin === "self" ? "self" : "foreign",
            drivable: entry.drivable !== false,
            readable: entry.readable === true,
            ...(entry.unreadableReason === "pending" || entry.unreadableReason === "unsupported"
              ? { unreadableReason: entry.unreadableReason }
              : {}),
            gated: entry.gated !== false,
            agent: typeof entry.agent === "string" ? entry.agent : undefined,
          });
          this.pendingTerminalCreates.delete(sessionId);
          // First paint comes from the descriptor's own state: the status
          // subscription only fires on change, so without it a reloaded client
          // shows nothing until something happens to move.
          const state = entry.state;
          if (state === "idle" || state === "running" || state === "requires_action") {
            store.setAgentState(sessionId, state);
          } else {
            store.setReceivedAuthoritativeState(sessionId, true);
          }
          // This state was read before this socket's sinks were bound, so a
          // prompt raised meanwhile arrives ahead of it: "running" may simply
          // be older than the card. It is trusted only against a card carried
          // over from before the socket opened — answered at the terminal
          // while no sink was bound to say so. "idle" is a turn over.
          const pending = store.sessions.get(sessionId)?.pendingPermission;
          if (
            pending &&
            (state === "idle" ||
              (state === "running" && this.cardsAtOpen.get(sessionId) === pending.requestId))
          ) {
            this.clearCard(sessionId);
          }
        }
        this.cardsAtOpen.clear();

        // Anything not in the list is gone. Materialise before mutating:
        // removeSession replaces the sessions Map.
        const dead = [...store.sessions.keys()].filter(
          (id) => !live.has(id) && !this.pendingTerminalCreates.has(id),
        );
        for (const id of dead) {
          store.removeSession(id);
          // removeSession prunes the persisted cursor; drop the in-memory one
          // too, or the next buffered event rewrites the whole map from memory
          // and resurrects the id we just forgot.
          this.lastEventIds.delete(id);
        }
        if (dead.length > 0) toastService.info("Terminal session ended");
        break;
      }

      case "session_state": {
        if (!sessionId) break;
        const { state } = msg as {
          sessionId: string;
          state: "idle" | "running" | "requires_action";
        };
        store.setAgentState(sessionId, state);
        // A pane that is working or settled is waiting on nobody: whoever
        // answered, the terminal or the phone, the card is over.
        if (state !== "requires_action") this.clearCard(sessionId);
        break;
      }

      case "stream_chunk": {
        if (!sessionId) break;
        const chunk = msg.chunk as Record<string, unknown>;

        const projected = messagesFromProjectedChunk(
          chunk,
          (part, index) =>
            `msg-${typeof chunk.recordId === "string" ? chunk.recordId : Date.now()}-${index}-${Math.random()}`,
        );
        const session = store.sessions.get(sessionId);
        if (!session) break;

        if (projected.length === 0) break;

        if (chunk.type === "assistant") {
          store.setStreaming(sessionId, true);
          store.applyTranscriptMessages(sessionId, {
            epoch: epochOfChunk(chunk),
            messages: projected,
          });
        } else if (chunk.type === "user") {
          // No setStreaming here (review advisory #3): a user record is the
          // prompt, not a reply, and whether the agent is working is
          // session_state's to say. A chunk-driven `true` that lands after an
          // authoritative idle is never cleared, because stream_end leaves the
          // flag alone once session_state has spoken.
          const userText = projected.find(
            (m) => m.kind === undefined && m.role === "user",
          )?.content;
          const now = Date.now();
          // An entry past the window can never pair again, so it is let go
          // here, where paired echoes are consumed. Otherwise every send whose
          // record never matched (the agent rewrote the text, or no record
          // came) would stay in this array until the tab closes.
          const pending = (this.lastOptimisticSend.get(sessionId) ?? []).filter(
            (send) => now - send.sentAt < ECHO_PAIRING_WINDOW_MS,
          );
          let echoId: string | undefined;
          if (userText) {
            const paired = pending.findIndex((send) => send.prompt.trim() === userText.trim());
            if (paired >= 0) {
              const [echo] = pending.splice(paired, 1);
              store.removeMessage(sessionId, echo.messageId);
              echoId = echo.messageId;
            }
          }
          if (pending.length === 0) this.lastOptimisticSend.delete(sessionId);
          else this.lastOptimisticSend.set(sessionId, pending);
          const messages = projected.map((m, i) =>
            i === 0 && echoId && m.kind === undefined ? { ...m, id: echoId } : m,
          );
          store.applyTranscriptMessages(sessionId, {
            epoch: epochOfChunk(chunk),
            messages,
          });
        }

        break;
      }

      case "stream_end":
        if (sessionId) {
          const session = store.sessions.get(sessionId);

          // If we received authoritative state during this turn, trust it
          // and skip the legacy stream_end setStreaming(false)
          if (session?.receivedAuthoritativeState) {
            // Reset flag for next turn, but don't touch streaming state
            store.setReceivedAuthoritativeState(sessionId, false);
            hapticService.complete();
            // Notify when response completes while app is in background
            if (document.hidden) {
              const settingsStore = useSettingsStore.getState();
              if (settingsStore.notificationsEnabled) {
                const cwd = store.sessions.get(sessionId)?.cwd;
                notificationService.showResponseComplete(sessionId, cwd);
              }
            }
          } else {
            // Backward compat: no session_state_changed received, use legacy behavior
            store.setStreaming(sessionId, false);
            hapticService.complete();
            // Notify when response completes while app is in background
            if (document.hidden) {
              const settingsStore = useSettingsStore.getState();
              if (settingsStore.notificationsEnabled) {
                const cwd = store.sessions.get(sessionId)?.cwd;
                notificationService.showResponseComplete(sessionId, cwd);
              }
            }
          }
        }
        break;

      case "permission_request":
        if (sessionId) {
          store.setPermission(sessionId, pendingFromPermissionRequest(msg));
          // Background notification when page is hidden
          const settingsStore = useSettingsStore.getState();
          const toolName = (msg.tool as { name: string }).name;
          // A question is not a permission request, and on a question the
          // `tool.name` slot holds the question's own header — so saying
          // "permission" here would be wrong twice over.
          const isQuestion = msg.promptKind === "question";
          if (document.hidden) {
            toastService.info(
              isQuestion ? `Needs your answer: ${toolName}` : `Permission requested: ${toolName}`,
            );
            if (settingsStore.notificationsEnabled) {
              const cwd = store.sessions.get(sessionId)?.cwd;
              if (isQuestion) {
                notificationService.showQuestionNotification(toolName, sessionId, cwd);
              } else {
                notificationService.showPermissionNotification(toolName, sessionId, cwd);
              }
            }
          }
        }
        break;

      case "transcript_page": {
        if (!sessionId) break;
        const request = store.sessions.get(sessionId)?.transcriptPageRequest;
        store.setTranscriptPageRequest(sessionId, null);

        // Records go through the same visible-text rule as live chunks, so a
        // page of tool plumbing legitimately yields no bubbles. Nothing here
        // touches isStreaming or the pending permission: loading older
        // conversation must not disturb the turn running right now.
        const records = (msg.records as Record<string, unknown>[]) ?? [];
        const messages: Message[] = [];
        for (const record of records) {
          const parts = messagesFromProjectedChunk(
            record,
            (_part, index) =>
              `page-${(record.recordId as string) ?? messages.length}-${index}-${Math.random()}`,
          );
          messages.push(...parts);
        }

        store.applyTranscriptMessages(sessionId, {
          epoch: msg.epoch as string,
          messages,
          nextBefore: (msg.nextBefore as TranscriptCursor | null) ?? null,
          // The pre-transcript local log gives way to the file, but only what
          // was already on screen when the request went out — a bubble sent
          // since then has not had its chance to appear in the transcript yet.
          ...(request ? { discardLocalBefore: request.sentAt } : {}),
        });
        break;
      }

      case "transcript_rotated": {
        if (!sessionId) break;
        // The terminal cleared its conversation. This is the epoch rule a
        // chunk from the new file would apply anyway, with no messages — it
        // only spares an idle phone from waiting for that chunk to arrive.
        store.applyTranscriptMessages(sessionId, {
          epoch: typeof msg.epoch === "string" ? msg.epoch : null,
          messages: [],
        });
        break;
      }

      case "capabilities_list": {
        this.clearCapabilitiesTimeout(sessionId);
        if (!sessionId) break;
        const commands = ((msg.commands as CommandInfo[]) ?? []).map((command) => ({
          name: command.name,
          ...(command.description ? { description: command.description } : {}),
          ...(command.category ? { category: command.category } : {}),
          ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
        }));
        const agents = ((msg.agents as AgentInfo[]) ?? []).map((agent) => ({
          name: agent.name,
          ...(agent.description ? { description: agent.description } : {}),
          ...(agent.allowedTools ? { allowedTools: agent.allowedTools } : {}),
          ...(agent.icon ? { icon: agent.icon } : {}),
        }));
        store.setSessionCapabilities(sessionId, { status: "ready", commands, agents });
        break;
      }

      case "error": {
        hapticService.error();
        // Clear directory loading state on any error
        store.setIsLoadingDirectories(false);

        // "This session has no transcript to read" is a fact about the session,
        // not something that went wrong: no toast, no error bubble, and above
        // all nothing discarded — this is also how the phone hears that an
        // agent has exited, and its conversation must stay on screen. All that
        // changes is that the request is no longer in flight, so the user can
        // try again.
        if (sessionId && msg.code === "transcript_unavailable") {
          store.setTranscriptPageRequest(sessionId, null);
          break;
        }

        if (
          sessionId &&
          (msg.code === "capabilities_unsupported" || msg.code === "capabilities_unavailable")
        ) {
          this.clearCapabilitiesTimeout(sessionId);
          store.setSessionCapabilities(sessionId, {
            status: "unavailable",
            reason: msg.code === "capabilities_unsupported" ? "unsupported" : "failed",
          });
          break;
        }

        // Terminal create failures arrive without a sessionId, so drop the
        // optimistic sessions still waiting for `terminal_created` — otherwise the
        // session list keeps a ghost that can never become ready.
        const createFailed =
          msg.code === "invalid_cwd" ||
          msg.code === "path_not_allowed" ||
          msg.code === "terminal_error";
        const creating = !sessionId && createFailed && this.pendingTerminalCreates.size > 0;
        if (creating) {
          for (const uuid of this.pendingTerminalCreates) {
            store.removeSession(uuid);
          }
          this.pendingTerminalCreates.clear();
        }

        // The prompt on the terminal changed before the tap arrived (somebody
        // answered it there, or claude moved on). Nothing was sent, so the sheet
        // must close rather than sit on a question that no longer exists.
        if (
          sessionId &&
          (msg.code === "permission_prompt_stale" || msg.code === "permission_option_unknown")
        ) {
          store.setPermission(sessionId, null);
          toastService.info(
            msg.code === "permission_prompt_stale"
              ? "The prompt changed in the terminal — nothing was sent."
              : "That option is no longer offered — nothing was sent.",
          );
          break;
        }

        // A refused prompt is not a turn: undo the optimistic send instead of
        // writing an assistant message into the transcript. Nothing reached
        // claude, so the bubble claiming otherwise comes off and the prompt goes
        // back where the user can edit and retry it — the composer was cleared
        // the moment the send left, long before this refusal arrived.
        if (sessionId && msg.code === "session_busy") {
          const arr = this.lastOptimisticSend.get(sessionId) || [];
          if (arr.length) {
            const attempted = arr.pop()!;
            if (arr.length === 0) this.lastOptimisticSend.delete(sessionId);
            else this.lastOptimisticSend.set(sessionId, arr);
            store.removeMessage(sessionId, attempted.messageId);
            if (store.activeSessionId === sessionId && store.inputDraft.trim() === "") {
              store.setInputDraft(attempted.prompt);
            }
          }
          toastService.info(msg.message as string);
          store.setStreaming(sessionId, false);
          break;
        }

        if (sessionId) {
          store.addMessage(sessionId, {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `Error: ${msg.message}`,
            timestamp: Date.now(),
          });
          store.setStreaming(sessionId, false);
        } else {
          console.warn(`[ws-service] ${msg.code}: ${msg.message}`);
          const text = describeServerError(
            String(msg.code ?? ""),
            String(msg.message ?? ""),
            creating,
          );
          store.setGlobalError(text);
          toastService.error(text);
        }
        break;
      }

      case "server_config": {
        // Only what the server knows and the client cannot: which paths are
        // allowed, and which agents this machine can launch. An agent's mode,
        // model and effort are its own settings and no longer travel here.
        const config = msg.config as {
          allowedRoots?: string[] | null;
          homeDirectory?: string;
          availableAgents?: string[];
          agentIntegrations?: Record<string, unknown> | null;
          agentProfiles?: unknown[];
        };
        if (config?.allowedRoots !== undefined || config?.homeDirectory) {
          store.setServerPaths({
            allowedRoots: config.allowedRoots ?? null,
            homeDirectory: config.homeDirectory ?? "~",
          });
        }
        if (Array.isArray(config?.availableAgents)) {
          store.setAvailableAgents(config.availableAgents.filter((k) => typeof k === "string"));
        }
        // `null` is an answer — the server could not ask herdr — while an
        // absent key says nothing and leaves the remembered states alone.
        if (config?.agentIntegrations === null) {
          store.setAgentIntegrations(null);
        } else if (typeof config?.agentIntegrations === "object") {
          store.setAgentIntegrations(
            Object.fromEntries(
              Object.entries(config.agentIntegrations).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            ),
          );
        }
        // Absent list = "this frame says nothing about profiles", which must
        // leave the remembered ones alone; an entry missing any of the three
        // fields is dropped rather than rendered as a button with no label.
        if (Array.isArray(config?.agentProfiles)) {
          store.setAgentProfiles(
            config.agentProfiles.filter((p): p is AgentProfile => {
              const entry = p as Partial<AgentProfile> | null;
              return (
                typeof entry?.id === "string" &&
                typeof entry?.label === "string" &&
                typeof entry?.kind === "string"
              );
            }),
          );
        }
        break;
      }

      case "directory_listing": {
        store.setDirectoryListing({
          path: msg.path as string,
          entries: (msg.entries as Array<{ name: string; path: string }>) || [],
          parent: (msg.parent as string | null) ?? null,
        });
        store.setIsLoadingDirectories(false);
        break;
      }
    }
  }

  /**
   * Starts a live terminal-backed session. The client owns the id: the session
   * appears in the store immediately (not ready) so the chat is navigable while
   * the server takes seconds to pass its readiness gate.
   * Returns the generated claudeUuid, or null when the socket is down.
   */
  createTerminalSession(cwd: string, agentKind?: string): string | null {
    if (!this.ws) return null;

    const claudeUuid = randomUuid();
    useAppStore.getState().addSession(claudeUuid, cwd, { ready: false });
    this.pendingTerminalCreates.add(claudeUuid);
    // Omitted rather than sent as undefined: the server reads an absent
    // agentKind as claude (#31), which is also what an older bundle sends.
    this.sendMessage(
      agentKind
        ? { type: "terminal_create", claudeUuid, cwd, agentKind }
        : { type: "terminal_create", claudeUuid, cwd },
    );

    return claudeUuid;
  }

  /**
   * Starts a live session from one of the server's launch profiles. Same
   * optimistic opening as `createTerminalSession` — the chat is navigable
   * immediately — but the only selector on the wire is the profile's id.
   *
   * Deliberately a separate method rather than a third argument: the server
   * refuses a `terminal_create` carrying both `agentKind` and `profileId` as
   * `invalid_message`, and a call site that cannot express the ambiguity
   * cannot produce it. The argv the profile expands to stays on the server and
   * never travels here.
   * Returns the generated claudeUuid, or null when the socket is down.
   */
  createTerminalSessionFromProfile(cwd: string, profileId: string): string | null {
    if (!this.ws) return null;

    const claudeUuid = randomUuid();
    useAppStore.getState().addSession(claudeUuid, cwd, { ready: false });
    this.pendingTerminalCreates.add(claudeUuid);
    this.sendMessage({ type: "terminal_create", claudeUuid, cwd, profileId });

    return claudeUuid;
  }

  /**
   * Asks a session for one page of its own transcript: the newest page when
   * `before` is absent, the page immediately older than that cursor otherwise.
   *
   * At most one request per session is outstanding — a double-tap on the
   * session card, or two scroll-to-top events before the reply lands, send one
   * request. Returns whether this call actually sent one, which is what the
   * caller renders its loading row from.
   */
  private clearCapabilitiesTimeout(sessionId: string | undefined) {
    if (!sessionId) return;
    const handle = this.capabilitiesTimeouts.get(sessionId);
    if (handle === undefined) return;
    clearTimeout(handle);
    this.capabilitiesTimeouts.delete(sessionId);
  }

  private armCapabilitiesTimeout(sessionId: string) {
    this.clearCapabilitiesTimeout(sessionId);
    const handle = setTimeout(() => {
      this.capabilitiesTimeouts.delete(sessionId);
      const session = useAppStore.getState().sessions.get(sessionId);
      if (!session || session.capabilities?.status !== "loading") return;
      useAppStore.getState().setSessionCapabilities(sessionId, {
        status: "unavailable",
        reason: "failed",
      });
    }, CAPABILITIES_REQUEST_TIMEOUT_MS);
    this.capabilitiesTimeouts.set(sessionId, handle);
  }

  /**
   * Ask one live session for its command / agent list. At most one request is
   * outstanding per session unless `refresh` is set. A missing socket writes
   * a terminating `unavailable`/`failed` so the picker never spins on a
   * request that was not sent.
   */
  requestCapabilities(sessionId: string, options?: { refresh?: boolean }): boolean {
    const store = useAppStore.getState();
    if (!store.sessions.has(sessionId)) return false;
    const current = store.sessions.get(sessionId)?.capabilities;
    if (!options?.refresh) {
      if (current?.status === "loading" || current?.status === "ready") return false;
    }
    if (!this.ws) {
      store.setSessionCapabilities(sessionId, { status: "unavailable", reason: "failed" });
      return false;
    }
    store.setSessionCapabilities(sessionId, { status: "loading", sentAt: Date.now() });
    this.armCapabilitiesTimeout(sessionId);
    this.sendMessage({
      type: "capabilities_request",
      sessionId,
      ...(options?.refresh ? { refresh: true } : {}),
    });
    return true;
  }

  requestTranscriptPage(sessionId: string, before?: TranscriptCursor | null): boolean {
    if (!this.ws) return false;
    const store = useAppStore.getState();
    // No session means nothing can hold the guard, and an unguarded request
    // would repeat on every scroll event.
    if (!store.sessions.has(sessionId)) return false;
    if (store.sessions.get(sessionId)?.transcriptPageRequest) return false;

    store.setTranscriptPageRequest(sessionId, { sentAt: Date.now() });
    this.sendMessage({
      type: "transcript_page_request",
      sessionId,
      ...(before ? { before } : {}),
    });
    return true;
  }

  /** Whether this session is waiting on a history page right now. */
  isTranscriptPageInFlight(sessionId: string): boolean {
    return Boolean(useAppStore.getState().sessions.get(sessionId)?.transcriptPageRequest);
  }

  /**
   * Sends one turn to a live terminal session. The session id doubles as the
   * claudeUuid, and the reply arrives through the usual stream_chunk/stream_end
   * handlers.
   */
  terminalSend(sessionId: string, prompt: string) {
    if (!this.ws) return;

    // Random suffix, not just the clock: two sends inside one millisecond used
    // to mint the same id, so removing one echo removed both and the supersede
    // could not tell the two bubbles apart.
    const messageId = `user-${Date.now()}-${Math.random()}`;
    useAppStore.getState().addMessage(sessionId, {
      id: messageId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    });
    const arr = this.lastOptimisticSend.get(sessionId) || [];
    arr.push({ messageId, prompt, sentAt: Date.now() });
    this.lastOptimisticSend.set(sessionId, arr);

    this.sendMessage({ type: "terminal_send", claudeUuid: sessionId, content: prompt });

    useAppStore.getState().setStreaming(sessionId, true);
  }

  private recordPermissionAction(
    sessionId: string,
    resolution: "approved" | "denied" | "answered",
    answers?: Record<string, string>,
  ) {
    const session = useAppStore.getState().sessions.get(sessionId);
    if (!session?.pendingPermission) return;
    const { tool } = session.pendingPermission;
    const answerSummary = answers
      ? Object.entries(answers)
          .map(([q, a]) => `${q}: ${a}`)
          .join(", ")
      : undefined;
    useAppStore.getState().addResolvedAction(sessionId, {
      id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "permission",
      timestamp: Date.now(),
      toolName: tool.name,
      parameters: tool.parameters,
      resolution,
      ...(answerSummary ? { answer: answerSummary } : {}),
    });
  }

  /**
   * Answers the pending prompt by naming one of the options the terminal is
   * offering. The server presses that option's key in the pane — there is no
   * generic "allow" any more, because the terminal's choices are not a fixed
   * two (a Bash prompt inside the project offers three, elsewhere two).
   *
   * `"cancel"` is the id of the synthetic Cancel action the server sends when
   * the screen could not be parsed; it maps to Esc.
   */
  answerPermissionOption(sessionId: string, optionId: string) {
    const session = useAppStore.getState().sessions.get(sessionId);
    if (!this.ws || !session?.pendingPermission) return;

    this.sendMessage({
      type: "permission",
      requestId: session.pendingPermission.requestId,
      optionId,
    });

    this.recordPermissionAction(
      sessionId,
      permissionResolution(session.pendingPermission, optionId),
    );
    useAppStore.getState().setPermission(sessionId, null);
  }

  /** Swipe-right shortcut: the terminal's first option — its one-shot "Yes". */
  approvePermission(sessionId: string) {
    const pending = useAppStore.getState().sessions.get(sessionId)?.pendingPermission;
    const first = pending?.options?.[0];
    // An unreadable screen's only option is the synthetic Esc: an approval
    // there would cancel whatever the terminal was asking.
    if (!first || first.id === "cancel") return;
    this.answerPermissionOption(sessionId, first.id);
  }

  /** Swipe-left shortcut: the terminal's own "No", or Esc when it offers none. */
  denyPermission(sessionId: string) {
    const pending = useAppStore.getState().sessions.get(sessionId)?.pendingPermission;
    const options = pending?.options ?? [];
    const no = options.find((entry) => /^no\b/i.test(entry.label));
    const target = no ?? options.find((entry) => entry.id === "cancel");
    if (!target) return;
    this.answerPermissionOption(sessionId, target.id);
  }

  closeSession(sessionId: string) {
    // A session the user opened in their own terminal is not ours to kill:
    // `workspace.close` there would take down the terminal they are working in,
    // and the conversation inside it. The server refuses it too (Decision M13);
    // this stops the request ever leaving the phone.
    const descriptor = useAppStore.getState().sessions.get(sessionId)?.descriptor;
    if (descriptor?.origin === "foreign") {
      toastService.info("That session belongs to a terminal — close it there.");
      return;
    }
    if (this.ws) {
      // Terminal-backed sessions own a live herdr workspace: `interrupt` only
      // reaches the SDK session manager, so without a teardown the `claude`
      // process would be orphaned until server shutdown.
      const isTerminal = useAppStore.getState().sessions.get(sessionId)?.terminal !== undefined;
      if (isTerminal) {
        this.sendMessage({ type: "terminal_teardown", claudeUuid: sessionId });
      } else {
        this.sendMessage({ type: "interrupt", sessionId });
      }
    }
    useAppStore.getState().removeSession(sessionId);
  }

  interrupt(sessionId: string) {
    if (!this.ws) return;
    this.sendMessage({ type: "interrupt", sessionId });
  }

  listDirectories(path: string) {
    if (!this.ws) return;
    useAppStore.getState().setIsLoadingDirectories(true);
    this.sendMessage({ type: "list_directories", path });
  }

  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  destroy() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}

export const wsService = new WsService();
