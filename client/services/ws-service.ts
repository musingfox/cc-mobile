import type { ContentBlock } from "../../server/protocol";
import { debugLog } from "../components/DebugOverlay";
import {
  type ActiveAgent,
  type ActiveTool,
  type Capabilities,
  useAppStore,
} from "../stores/app-store";
import { useSettingsStore } from "../stores/settings-store";
import { randomUuid } from "../utils/uuid";
import { hapticService } from "./haptic";
import { notificationService } from "./notification";
import { saveProject } from "./projects";
import { toastService } from "./toast-service";
import {
  type CompactBoundaryEvent,
  isApiRetry,
  isCompactBoundary,
  isHookResponse,
  isHookStarted,
  isMemoryRecall,
  isNotification,
  isPermissionDenied,
  isPromptSuggestion,
  isRateLimitEvent,
  isResultMessage,
  isSessionStateChanged,
  isTaskNotification,
  isTaskProgress,
  isTaskStarted,
  isToolProgress,
  isToolStart,
  isToolUseSummary,
  type MemoryRecallEvent,
  type PermissionDeniedEvent,
  type TerminalReason,
} from "./tool-events";

/**
 * Resolve the subagent attribution for a completed tool by walking
 * `precedingToolUseIds` → `activeTools[id].parentToolUseId` → `activeAgents`
 * (matched by `toolUseId`). Returns the first non-null match across the batch
 * so a summary covering multiple tool ids still attributes correctly.
 */
export function resolveAgentAttribution(
  session: { activeTools: Map<string, ActiveTool>; activeAgents: Map<string, ActiveAgent> },
  precedingToolUseIds: string[],
): { label: string; description: string } | null {
  if (!precedingToolUseIds || precedingToolUseIds.length === 0) return null;

  for (const toolUseId of precedingToolUseIds) {
    const tool = session.activeTools.get(toolUseId);
    if (!tool) continue;
    const parentId = tool.parentToolUseId;
    if (!parentId) continue;

    for (const agent of session.activeAgents.values()) {
      if (agent.toolUseId === parentId) {
        return {
          label: agent.taskType ?? "Agent",
          description: agent.description,
        };
      }
    }
  }

  return null;
}

/**
 * Synthesize an `ActiveTool` entry for an SDK `memory_recall` system message
 * so it surfaces in `ActivityStrip` like any other tool. Existing sweepers
 * (e.g. text content_block_start, assistant turn cleanup) drop the entry
 * once the model starts replying — no dedicated removal path is required.
 */
export function handleMemoryRecallChunk(
  sessionId: string,
  chunk: unknown,
  store: { addActiveTool: (sessionId: string, toolUseId: string, tool: ActiveTool) => void },
  now: () => number = Date.now,
): boolean {
  if (!isMemoryRecall(chunk)) return false;
  const c = chunk as MemoryRecallEvent;
  const memories = Array.isArray(c.memories) ? c.memories : [];
  const paths = memories.map((m) => m?.path).filter((p): p is string => typeof p === "string");
  const key = `memory-${c.uuid ?? "unknown"}`;
  store.addActiveTool(sessionId, key, {
    toolName: "Memory",
    startedAt: now(),
    input: {
      paths,
      count: paths.length,
      ...(c.mode !== undefined ? { mode: c.mode } : {}),
    },
  });
  return true;
}

/**
 * Append a greyed inline `permission_denied` marker to the chat and clear
 * the corresponding ActiveTool entry (if present). Triggered by SDK
 * `{type:"system", subtype:"permission_denied"}` chunks for auto-denials
 * (mode/rule/classifier) — interactive denials go through `canUseTool`.
 */
export function handlePermissionDeniedChunk(
  sessionId: string,
  chunk: unknown,
  store: {
    addMessage: (sessionId: string, message: import("../stores/app-store").Message) => void;
    removeActiveTool: (sessionId: string, toolUseId: string) => void;
  },
  now: () => number = Date.now,
): boolean {
  if (!isPermissionDenied(chunk)) return false;
  const c = chunk as PermissionDeniedEvent;
  const toolName = typeof c.tool_name === "string" && c.tool_name ? c.tool_name : "unknown tool";
  const id = `deny-${c.uuid ?? `${now()}-${Math.random().toString(36).slice(2, 8)}`}`;
  store.addMessage(sessionId, {
    id,
    kind: "permission_denied",
    role: "assistant",
    toolName,
    content: typeof c.message === "string" ? c.message : "",
    timestamp: now(),
  });
  if (typeof c.tool_use_id === "string" && c.tool_use_id) {
    store.removeActiveTool(sessionId, c.tool_use_id);
  }
  return true;
}

/**
 * Dedupe API retry toasts within a single turn. The SDK emits one
 * `api_retry` message per attempt; if `(error_status, attempt)` has
 * already been surfaced, suppress the re-emit so a 3-retry burst no
 * longer produces duplicate toasts for the same attempt index.
 *
 * Compound key preserves the 1/3 → 2/3 → 3/3 progression while
 * collapsing accidental duplicates. Caller is expected to clear
 * `seenKeys` on `stream_end`.
 */
export function handleApiRetryChunk(
  chunk: Record<string, unknown>,
  seenKeys: Set<string>,
): boolean {
  if (!isApiRetry(chunk)) return false;
  const statusKey = chunk.error_status ?? "unknown";
  const key = `${statusKey}-${chunk.attempt}`;
  if (seenKeys.has(key)) return true; // handled (suppressed)
  seenKeys.add(key);
  const delayMs = chunk.retry_delay_ms as number | undefined;
  const delaySec = delayMs && delayMs > 0 ? Math.round(delayMs / 1000) : 0;
  const suffix = delaySec > 0 ? ` in ${delaySec}s...` : "...";
  toastService.info(`API retrying (${chunk.attempt}/${chunk.max_retries})${suffix}`);
  return true;
}

/**
 * Map an SDK `notification` chunk to a toast with priority-based
 * severity. Deduped by `key` (or by `text:<text>` when `key` is absent
 * or empty). Priority routing:
 *   - `immediate` | `high` → `toastService.error`
 *   - `medium` | unknown    → `toastService.info`
 *   - `low`                → `toastService.info` (shorter timeout)
 * Default timeouts: error 6000ms, medium 4000ms, low 2000ms; overridden
 * by `chunk.timeout_ms` when provided.
 */
export function handleNotificationChunk(
  chunk: Record<string, unknown>,
  seenKeys: Set<string>,
): boolean {
  if (!isNotification(chunk)) return false;
  const dedupeKey =
    typeof chunk.key === "string" && chunk.key.length > 0 ? chunk.key : `text:${chunk.text}`;
  if (seenKeys.has(dedupeKey)) return true; // handled (suppressed)
  seenKeys.add(dedupeKey);

  const text = chunk.text;
  const priority = chunk.priority;
  const timeoutMs = typeof chunk.timeout_ms === "number" ? chunk.timeout_ms : undefined;

  if (priority === "immediate" || priority === "high") {
    toastService.error(text, timeoutMs ?? 6000);
  } else if (priority === "low") {
    toastService.info(text, timeoutMs ?? 2000);
  } else {
    // medium or unknown value
    toastService.info(text, timeoutMs ?? 4000);
  }
  return true;
}

/**
 * Surface SDK `compact_boundary` system events as in-chat dividers. We append
 * a synthetic `Message` flagged with `kind: "compact_boundary"` so the chat
 * renderer can draw a "history compacted" separator between the last
 * pre-compact and first post-compact turn.
 *
 * The divider is session-only — `HistoryMessageSchema` is intentionally NOT
 * extended, so reloads from disk won't include it.
 */
export function handleCompactBoundaryChunk(
  sessionId: string,
  chunk: unknown,
  store: {
    sessions: Map<string, { messages: unknown[] }>;
    addMessage: (sessionId: string, message: import("../stores/app-store").Message) => void;
  },
  now: () => number = Date.now,
): boolean {
  if (!isCompactBoundary(chunk)) return false;
  const c = chunk as CompactBoundaryEvent;
  if (!c.compact_metadata || typeof c.compact_metadata !== "object") {
    console.warn("[ws-service] compact_boundary chunk missing compact_metadata", { chunk });
    return false;
  }
  const session = store.sessions.get(sessionId);
  if (!session) return false;
  const meta = c.compact_metadata;
  const trigger: "manual" | "auto" = meta.trigger === "manual" ? "manual" : "auto";
  const compactMetadata: import("../stores/app-store").CompactMetadata = {
    trigger,
    ...(typeof meta.pre_tokens === "number" ? { preTokens: meta.pre_tokens } : {}),
    ...(typeof meta.post_tokens === "number" ? { postTokens: meta.post_tokens } : {}),
  };
  store.addMessage(sessionId, {
    id: `compact-${c.session_id ?? sessionId}-${c.uuid ?? "unknown"}`,
    role: "assistant",
    content: "",
    timestamp: now(),
    kind: "compact_boundary",
    compactMetadata,
  });
  return true;
}

// Fallback context window when the active model's contextLength is unknown.
// 200k matches Claude Sonnet 4.x; conservative for newer models.
export const MAX_TOKENS_FALLBACK = 200_000;

// Context window for the 1M-context beta models (marked with a "[1m]" suffix in
// the model string, e.g. "claude-opus-4-8[1m]").
export const ONE_MILLION_CONTEXT = 1_000_000;

/**
 * Resolve the effective context window for a model. The catalogued contextLength
 * does not reflect the 1M beta, so a "[1m]" suffix in the model string overrides
 * it. Returns undefined when neither signal is present (caller falls back).
 */
export function resolveContextWindow(
  modelValue: string | undefined,
  contextLength: number | undefined,
): number | undefined {
  if (modelValue?.includes("[1m]")) return ONE_MILLION_CONTEXT;
  return contextLength;
}

/**
 * Derive an aggregate context-occupancy snapshot from a `result.usage` payload.
 * Sums input, output, and cached input tokens (the same components Anthropic
 * counts against the context window). Returns `null` when the payload is
 * missing entirely so callers can preserve the previous chip reading.
 */
export function deriveContextUsage(
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | undefined,
  maxTokens: number | null | undefined,
): { totalTokens: number; maxTokens: number; percentage: number } | null {
  if (!usage || typeof usage !== "object") return null;
  const totalTokens =
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  const effectiveMax =
    typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : MAX_TOKENS_FALLBACK;
  const percentage = totalTokens / effectiveMax;
  return { totalTokens, maxTokens: effectiveMax, percentage };
}

export function extractTextFromChunk(chunk: Record<string, unknown>): string | null {
  const message = chunk.message as
    | { role?: string; content?: Array<{ type: string; text?: string }> | string }
    | undefined;

  const isUser = chunk.type === "user" || message?.role === "user";

  if (chunk.type === "assistant" || isUser) {
    if (!message) return null;
    if (typeof message.content === "string") {
      const s = message.content;
      if (s.includes("<command-name>") || s.includes("<local-command-stdout>")) return null;
      return s || null;
    }
    if (!message.content || !Array.isArray(message.content)) return null;
    // drop if only tool_result or wrappers
    const texts = message.content
      .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text);
    if (texts.length === 0) return null;
    const joined = texts.join("");
    if (joined.includes("<command-name>") || joined.includes("<local-command-stdout>")) return null;
    return joined || null;
  }

  if (chunk.type === "stream_event") {
    const event = chunk.event as Record<string, unknown> | undefined;
    if (!event) return null;

    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (!delta) return null;

      if (delta.type === "text_delta") {
        return (delta.text as string) ?? null;
      }
    }
  }

  return null;
}

export function getTerminalReasonMessage(reason: TerminalReason | undefined): string | null {
  if (!reason || reason === "completed") return null;

  switch (reason) {
    case "max_turns":
      return "Maximum turns reached. You can continue the conversation to proceed.";
    case "blocking_limit":
      return "Rate limit reached. Please try again later.";
    case "rapid_refill_breaker":
      return "Too many requests in a short time. Please wait before continuing.";
    case "prompt_too_long":
      return "Prompt exceeds maximum length.";
    case "image_error":
      return "Image processing error occurred.";
    case "model_error":
      return "Model error occurred.";
    case "aborted_streaming":
      return "Streaming was aborted.";
    case "aborted_tools":
      return "Tool execution was aborted.";
    case "stop_hook_prevented":
      return "Stop hook prevented continuation.";
    case "hook_stopped":
      return "Hook stopped execution.";
    case "tool_deferred":
      return "Tool execution was deferred.";
    default:
      return null;
  }
}

class WsService {
  private ws: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private reconnectDelay = 1000;
  private lastToolBatchTime = 0;
  // Per-session replay cursor. eventIds are assigned per-session by the server
  // (starting at 1), so a single global cursor would mis-baseline replay across
  // sessions and silently drop missed events on reconnect (→ stuck spinner).
  private lastEventIds = new Map<string, number>();
  private disconnectBannerTimeout: number | null = null;
  // Dedupe set for `api_retry` toasts within a single turn. Cleared on
  // `stream_end`. Key shape: `${error_status ?? "unknown"}-${attempt}`.
  private apiRetrySeenKeys = new Set<string>();
  // Dedupe set for `notification` toasts across the WS connection. Key is the
  // notification `key` (globally unique per event) or `text:<text>` fallback;
  // cleared on disconnect so a fresh session starts unbiased.
  private notificationSeenKeys = new Set<string>();
  // Terminal sessions awaiting their `terminal_created` reply. Create failures come
  // back without a claudeUuid, so a failure clears every pending optimistic
  // session rather than guessing which one it belongs to.
  private pendingTerminalCreates = new Set<string>();
  // The prompt each session last handed to the server, with the id of the
  // optimistic bubble it drew for it. A refusal (`session_busy`) is the one
  // reply that means the turn never happened: the bubble has to come back off
  // the screen and the text has to go back in the composer, or the user loses
  // what they typed to a send that was never made.
  private lastOptimisticSend = new Map<string, Array<{ messageId: string; prompt: string; sentAt: number }>>();

  private sendMessage(msg: Record<string, unknown>) {
    if (!this.ws) return;
    debugLog.add("send", msg);
    this.ws.send(JSON.stringify(msg));
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
    const ws = new WebSocket(`${protocol}//${window.location.host}${basePath}/ws`);

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
      this.ws = null;
      // Reset notification dedupe — a fresh session starts unbiased.
      this.notificationSeenKeys.clear();
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
        }

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
        break;
      }

      case "stream_chunk": {
        if (!sessionId) break;
        const chunk = msg.chunk as Record<string, unknown>;

        // Capture sdkSessionId from system/init message
        if (chunk.type === "system" && chunk.subtype === "init" && chunk.session_id) {
          store.setSdkSessionId(sessionId, chunk.session_id as string);
        }

        // Handle session_state_changed from stream_chunk (redundant detection for backward compat)
        if (isSessionStateChanged(chunk)) {
          store.setAgentState(sessionId, chunk.state);
          break;
        }

        // Handle hook started — clear stale tools since hooks run after turn completes
        if (isHookStarted(chunk)) {
          store.clearActiveTools(sessionId);
          store.clearActiveAgents(sessionId);
          store.setActiveToolStatus(sessionId, null);
          store.setActiveHook(sessionId, { hookId: chunk.hook_id, hookName: chunk.hook_name });
          break;
        }

        // Handle hook response
        if (isHookResponse(chunk)) {
          store.setActiveHook(sessionId, null);
          break;
        }

        // Handle rate limit events
        if (isRateLimitEvent(chunk)) {
          store.setRateLimitInfo(chunk.rate_limit_info);
          break;
        }

        // Handle API retry notifications (with per-turn dedupe)
        if (handleApiRetryChunk(chunk, this.apiRetrySeenKeys)) {
          break;
        }

        // Handle SDK notification queue (priority-routed toast, dedup by key)
        if (handleNotificationChunk(chunk, this.notificationSeenKeys)) {
          break;
        }

        // Handle prompt suggestions
        if (isPromptSuggestion(chunk)) {
          if (sessionId) {
            store.setPromptSuggestion(sessionId, chunk.suggestion);
          }
          break;
        }

        // Handle result messages (cost/token data)
        // Result marks end of turn — clear stale tool/agent state
        if (isResultMessage(chunk)) {
          const terminalReason = chunk.terminal_reason;
          store.updateUsage(sessionId, {
            totalCost: chunk.total_cost_usd ?? 0,
            inputTokens: chunk.usage?.input_tokens ?? 0,
            outputTokens: chunk.usage?.output_tokens ?? 0,
            cacheReadTokens: chunk.usage?.cache_read_input_tokens ?? 0,
            cacheCreationTokens: chunk.usage?.cache_creation_input_tokens ?? 0,
            turns: chunk.num_turns ?? 0,
            durationMs: chunk.duration_ms ?? 0,
            terminalReason,
          });

          // Refresh context-occupancy chip from the same usage payload.
          // Active model lookup keys on `capabilities.model`; fall back to
          // MAX_TOKENS_FALLBACK when the model isn't catalogued.
          const activeModelValue = store.capabilities?.model;
          const activeModel = store.capabilities?.models?.find((m) => m.value === activeModelValue);
          const maxTokens = resolveContextWindow(activeModelValue, activeModel?.contextLength);
          const contextUsage = deriveContextUsage(chunk.usage, maxTokens);
          if (contextUsage) {
            store.setContextUsage(sessionId, contextUsage);
          }

          // Show toast for abnormal terminal reasons
          const errorMessage = getTerminalReasonMessage(terminalReason);
          if (errorMessage) {
            toastService.error(errorMessage);
          }

          store.clearActiveTools(sessionId);
          store.clearActiveAgents(sessionId);
          store.setActiveToolStatus(sessionId, null);
          break;
        }

        // When the model starts producing text, all tools are done
        if (
          chunk.type === "stream_event" &&
          (chunk.event as Record<string, unknown> | undefined)?.type === "content_block_start" &&
          (
            (chunk.event as Record<string, unknown> | undefined)?.content_block as
              | Record<string, unknown>
              | undefined
          )?.type === "text"
        ) {
          store.clearActiveTools(sessionId);
          store.setActiveToolStatus(sessionId, null);
        }

        // Handle tool start (earliest signal)
        if (isToolStart(chunk)) {
          const { event } = chunk;
          const { content_block } = event;
          const now = Date.now();

          // Detect new tool batch: if >200ms since last tool start,
          // this is a new sequential tool (not parallel). Clean up
          // stale root tools from the previous batch, since tool_use_summary
          // may not reliably fire for every tool.
          if (now - this.lastToolBatchTime > 200) {
            const session = store.sessions.get(sessionId);
            if (session) {
              for (const [toolId, tool] of session.activeTools) {
                if (!tool.parentToolUseId) {
                  store.removeActiveTool(sessionId, toolId);
                }
              }
            }
          }
          this.lastToolBatchTime = now;

          store.addActiveTool(sessionId, content_block.id, {
            toolName: content_block.name,
            startedAt: now,
          });
          store.setActiveToolStatus(sessionId, {
            toolName: content_block.name,
            description: content_block.name,
          });
          break;
        }

        // Handle tool progress updates
        if (isToolProgress(chunk)) {
          if (chunk.tool_use_id) {
            store.updateActiveTool(sessionId, chunk.tool_use_id, {
              ...(chunk.elapsed_time_seconds !== undefined && {
                elapsedSeconds: chunk.elapsed_time_seconds,
              }),
              ...(chunk.parent_tool_use_id !== undefined && {
                parentToolUseId: chunk.parent_tool_use_id,
              }),
            });
          }
          // Maintain backward compatibility
          store.setActiveToolStatus(sessionId, {
            toolName: chunk.tool_name,
            description: chunk.tool_name,
          });
          break;
        }

        // Handle tool completion summary
        if (isToolUseSummary(chunk)) {
          const session = store.sessions.get(sessionId);
          const toolName = session?.activeToolStatus?.toolName ?? "Tool";
          const precedingIds = Array.isArray(chunk.preceding_tool_use_ids)
            ? chunk.preceding_tool_use_ids
            : [];
          // Resolve attribution BEFORE removeActiveTool clears entries.
          const attribution = session ? resolveAgentAttribution(session, precedingIds) : null;
          store.addToolMessage(
            sessionId,
            toolName,
            chunk.summary,
            attribution
              ? { agentLabel: attribution.label, agentDescription: attribution.description }
              : undefined,
          );
          // Remove all completed tools
          precedingIds.forEach((id) => {
            store.removeActiveTool(sessionId, id);
          });
          // Clear legacy status
          store.setActiveToolStatus(sessionId, null);
          break;
        }

        // Handle agent/task started
        if (isTaskStarted(chunk)) {
          store.addActiveAgent(sessionId, chunk.task_id, {
            description: chunk.description,
            taskType: chunk.task_type,
            status: "running",
            ...(chunk.tool_use_id ? { toolUseId: chunk.tool_use_id } : {}),
          });
          break;
        }

        // Handle agent/task progress
        if (isTaskProgress(chunk)) {
          if (chunk.task_id) {
            store.updateActiveAgent(sessionId, chunk.task_id, {
              toolCount: chunk.usage?.tool_uses,
              tokenCount: chunk.usage?.total_tokens,
              summary: chunk.summary,
            });
          }
          // Update legacy status if tool name present
          if (chunk.last_tool_name) {
            store.setActiveToolStatus(sessionId, {
              toolName: chunk.last_tool_name,
              description: chunk.description,
            });
          }
          break;
        }

        // Handle agent/task completion
        if (isTaskNotification(chunk)) {
          store.completeActiveAgent(sessionId, chunk.task_id, {
            status: chunk.status,
            summary: chunk.summary,
            toolCount: chunk.usage?.tool_uses,
            tokenCount: chunk.usage?.total_tokens,
          });
          break;
        }

        // Surface memory_recall as a synthetic `Memory` ActiveTool entry.
        // Existing sweepers (text content_block_start, assistant turn cleanup)
        // remove it once the model starts replying.
        if (handleMemoryRecallChunk(sessionId, chunk, store)) {
          break;
        }

        // Surface compact_boundary as an in-chat divider message.
        if (handleCompactBoundaryChunk(sessionId, chunk, store)) {
          break;
        }

        // Non-interactive permission denials (mode/rule/classifier) — render
        // inline grey marker and drop matching ActiveTool entry.
        if (handlePermissionDeniedChunk(sessionId, chunk, store)) {
          break;
        }

        // Extract tool input from assistant messages for ActivityPanel display.
        // Also clean up stale tools from previous turns: an `assistant` chunk
        // signals a new turn, so any active tools NOT listed in this message's
        // content are leftovers that the SDK already finished executing.
        if (chunk.type === "assistant") {
          const message = chunk.message as { content?: Array<Record<string, unknown>> } | undefined;
          const currentTurnToolIds = new Set<string>();
          if (message?.content) {
            for (const block of message.content) {
              if (block.type === "tool_use" && typeof block.id === "string") {
                currentTurnToolIds.add(block.id);
                if (block.input) {
                  store.updateActiveTool(sessionId, block.id as string, {
                    input: block.input as Record<string, unknown>,
                  });
                }
              }
            }
          }
          // Remove tools from previous turns
          const session = store.sessions.get(sessionId);
          if (session) {
            for (const [toolId, tool] of session.activeTools) {
              if (!currentTurnToolIds.has(toolId) && !tool.parentToolUseId) {
                store.removeActiveTool(sessionId, toolId);
              }
            }
          }
        }

        const text = extractTextFromChunk(chunk);
        if (!text) break;

        const session = store.sessions.get(sessionId);
        if (!session) break;

        store.setStreaming(sessionId, true);

        // Handle stream_event chunks: create/append incrementally
        if (chunk.type === "stream_event") {
          if (session.currentStreamMessageId) {
            store.appendToLastAssistantMessage(sessionId, text);
          } else {
            const newId = `msg-${Date.now()}-${Math.random()}`;
            store.startStreamMessage(sessionId, newId, text);
          }
        }
        // Handle assistant messages: dedup if already streamed
        else if (chunk.type === "assistant") {
          // Dedup: skip if this is the final message matching the current stream
          if (session.currentStreamMessageId) {
            const lastMsg = session.messages[session.messages.length - 1];
            if (lastMsg?.id === session.currentStreamMessageId && lastMsg.content === text) {
              break;
            }
          }
          // Not a duplicate: create new message
          const newId = `msg-${Date.now()}-${Math.random()}`;
          store.addMessage(sessionId, {
            id: newId,
            role: "assistant",
            content: text,
            timestamp: Date.now(),
          });
        } else if (chunk.type === "user") {
          const rid = (chunk as any).recordId as string | undefined;
          const sq = (chunk as any).seq as number | undefined;
          // Optimistic echo supersede: if matches last send within time bound, remove echo, use this record bubble
          const arr = this.lastOptimisticSend.get(sessionId) || [];
          const now = Date.now();
          const idx = arr.findIndex(a => a.prompt.trim() === text.trim() && now - a.sentAt < 300000);
          if (idx >= 0) {
            const [attempted] = arr.splice(idx, 1);
            if (arr.length === 0) this.lastOptimisticSend.delete(sessionId); else this.lastOptimisticSend.set(sessionId, arr);
            store.removeMessage(sessionId, attempted.messageId);
            const newId = `user-${Date.now()}-${Math.random()}`;
            store.addMessage(sessionId, {
              id: newId,
              role: "user",
              content: text,
              timestamp: Date.now(),
              ...(rid ? { recordId: rid } : {}),
              ...(typeof sq === "number" ? { seq: sq } : {}),
            });
          } else {
            const newId = `user-${Date.now()}-${Math.random()}`;
            store.addMessage(sessionId, {
              id: newId,
              role: "user",
              content: text,
              timestamp: Date.now(),
              ...(rid ? { recordId: rid } : {}),
              ...(typeof sq === "number" ? { seq: sq } : {}),
            });
          }
        }
        break;
      }

      case "stream_end":
        // Re-arm api_retry dedupe so the next turn can show its own toasts.
        this.apiRetrySeenKeys.clear();
        if (sessionId) {
          const session = store.sessions.get(sessionId);

          // Snapshot completed activity before clearing
          if (session) {
            const completedTools = Array.from(session.activeTools.values());
            const completedAgents = Array.from(session.activeAgents.values()).filter(
              (a) => a.status !== "running",
            );
            if (completedTools.length > 0 || completedAgents.length > 0) {
              store.addResolvedAction(sessionId, {
                id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: "activity",
                timestamp: Date.now(),
                tools: completedTools.map((t) => ({
                  toolName: t.toolName,
                  elapsed: t.elapsedSeconds ? `${Math.floor(t.elapsedSeconds)}s` : undefined,
                })),
                agents: completedAgents.map((a) => ({
                  description: a.description,
                  toolCount: a.toolCount,
                  tokenCount: a.tokenCount,
                })),
              });
            }
          }

          // If we received authoritative state during this turn, trust it
          // and skip the legacy stream_end setStreaming(false)
          if (session?.receivedAuthoritativeState) {
            // Reset flag for next turn, but don't touch streaming state
            store.setReceivedAuthoritativeState(sessionId, false);
            // Still do cleanup
            store.setActiveToolStatus(sessionId, null);
            store.clearActiveTools(sessionId);
            store.clearActiveAgents(sessionId);
            store.setActiveHook(sessionId, null);
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
            store.setActiveToolStatus(sessionId, null);
            store.clearActiveTools(sessionId);
            store.clearActiveAgents(sessionId);
            store.setActiveHook(sessionId, null);
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
          // The options are the terminal's own, parsed off its screen — never
          // synthesised here. An empty list means the screen was unreadable and
          // the sheet offers Cancel only.
          const options = Array.isArray(msg.options)
            ? (msg.options as { id: string; label: string; keystroke: string }[])
            : [];
          store.setPermission(sessionId, {
            requestId: msg.requestId as string,
            tool: msg.tool as {
              name: string;
              parameters: Record<string, unknown>;
            },
            options,
          });
          // Background notification when page is hidden
          const settingsStore = useSettingsStore.getState();
          const toolName = (msg.tool as { name: string }).name;
          if (document.hidden) {
            toastService.info(`Permission requested: ${toolName}`);
            if (settingsStore.notificationsEnabled) {
              const cwd = store.sessions.get(sessionId)?.cwd;
              notificationService.showPermissionNotification(toolName, sessionId, cwd);
            }
          }
        }
        break;

      case "capabilities":
        // Zod's union+transform pipeline confuses TS inference; cast to the store shape.
        store.setCapabilities({
          commands: (msg.commands as Capabilities["commands"]) ?? [],
          agents: (msg.agents as Capabilities["agents"]) ?? [],
          model: (msg.model as string) ?? "unknown",
          ...(msg.models ? { models: msg.models as Capabilities["models"] } : {}),
          ...(msg.accountInfo
            ? { accountInfo: msg.accountInfo as Capabilities["accountInfo"] }
            : {}),
        });
        break;

      case "error": {
        hapticService.error();
        // Clear directory loading state on any error
        store.setIsLoadingDirectories(false);

        // Terminal create failures arrive without a sessionId, so drop the
        // optimistic sessions still waiting for `terminal_created` — otherwise the
        // session list keeps a ghost that can never become ready.
        const createFailed =
          msg.code === "invalid_cwd" ||
          msg.code === "path_not_allowed" ||
          msg.code === "terminal_error";
        if (!sessionId && createFailed && this.pendingTerminalCreates.size > 0) {
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
            if (arr.length === 0) this.lastOptimisticSend.delete(sessionId); else this.lastOptimisticSend.set(sessionId, arr);
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
          store.setGlobalError(msg.message as string);
          toastService.error(msg.message as string);
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
   * Sends one turn to a live terminal session. The session id doubles as the
   * claudeUuid, and the reply arrives through the usual stream_chunk/stream_end
   * handlers.
   */
  terminalSend(sessionId: string, prompt: string) {
    if (!this.ws) return;

    const messageId = `user-${Date.now()}`;
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
    // Clear any pending prompt suggestion — it's stale once the user sends.
    useAppStore.getState().setPromptSuggestion(sessionId, null);
  }

  /**
   * TODO(#25-followup): the server buffers this but nothing drains the buffer —
   * the SDK turn driver that used to prepend it is gone. There is no production
   * caller today; the method is kept so the follow-up ticket can reconnect it.
   */
  appendUserMessage(sessionId: string, content: string | ContentBlock[]) {
    if (!this.ws) return;

    // Derive the display text the same way the chat bubble shows it while typing.
    let displayContent: string;
    let contentBlocks: ContentBlock[] | undefined;

    if (typeof content === "string") {
      displayContent = content;
    } else {
      const textBlocks = content.filter((block) => block.type === "text");
      displayContent = textBlocks.map((block) => block.text).join("\n");
      contentBlocks = content;
    }

    useAppStore.getState().addMessage(sessionId, {
      id: `user-${Date.now()}`,
      role: "user",
      content: displayContent,
      timestamp: Date.now(),
      ...(contentBlocks ? { contentBlocks } : {}),
    });

    this.sendMessage({ type: "append_user_message", sessionId, content });
    // Do NOT set streaming — no turn is driven by this frame.
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

    const option = session.pendingPermission.options?.find((entry) => entry.id === optionId);
    const denied = optionId === "cancel" || /^no\b/i.test(option?.label ?? "");
    this.recordPermissionAction(sessionId, denied ? "denied" : "approved");
    useAppStore.getState().setPermission(sessionId, null);
  }

  /** Swipe-right shortcut: the terminal's first option — its one-shot "Yes". */
  approvePermission(sessionId: string) {
    const pending = useAppStore.getState().sessions.get(sessionId)?.pendingPermission;
    const first = pending?.options?.[0];
    if (!first) return;
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

  /**
   * Stop a single subagent task without aborting the parent conversation.
   * The server emits an `error` message (code `no_active_query` or
   * `stop_task_failed`) if the SDK cannot stop the task.
   */
  stopTask(sessionId: string, taskId: string) {
    if (!this.ws) return;
    this.sendMessage({ type: "stop_task", sessionId, taskId });
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
