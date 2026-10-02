import type { ResolvedAction, SessionState } from "../stores/app-store";

// localStorage keys
const SESSION_KEY_PREFIX = "ccm:session:";
const ACTIVE_SESSION_KEY = "ccm:active-session";
const SESSION_IDS_KEY = "ccm:session-ids";
/** Per-session replay cursors, written by ws-service on every buffered event. */
const LAST_EVENT_IDS_KEY = "ccm:lastEventIds";

interface SerializableSessionState {
  id: string;
  cwd: string;
  messages: SessionState["messages"];
  pendingPermission: SessionState["pendingPermission"];
  isStreaming: boolean;
  resolvedActions: ResolvedAction[];
  agentState: "idle" | "running" | "requires_action" | null;
  receivedAuthoritativeState: boolean;
  // Must survive a reload: send routing keys on this marker, so dropping it
  // would silently send a live terminal session's prompt down the PTY path.
  terminal?: { ready: boolean };
  /**
   * Which transcript file the restored messages were built from. Without it,
   * every reload would look exactly like a rotation — "unknown epoch" is
   * indistinguishable from "a different file" — and the first history page
   * after a reload would silently destroy the restored conversation instead of
   * merging into it.
   *
   * The paging cursor is deliberately NOT persisted: an absent cursor self-heals
   * on the next activation fetch, whereas a stale one would have to be validated
   * against a file that may have rotated while the app was closed.
   */
  epoch?: string;
}

const TRANSIENT_PART_KINDS = new Set(["thinking", "tool_use", "tool_result"]);

/**
 * Kinds only the deleted SDK chunk pipeline ever produced. Nothing renders them
 * any more, so one restored from an older blob would fall through to an empty
 * assistant bubble.
 */
const RETIRED_MESSAGE_KINDS = new Set(["compact_boundary", "permission_denied"]);

/**
 * Fields older bundles wrote into every session blob, for state whose only
 * producer is gone: the streaming bubble, and the SDK chunk pipeline behind the
 * activity strip, the usage bar, the context chip and the prompt suggestion.
 * Those blobs are still on phones, so they must load; each field is dropped on
 * the way in rather than carried onto the session and written back out.
 */
const RETIRED_SESSION_FIELDS = [
  "currentStreamMessageId",
  "sdkSessionId",
  "activeToolStatus",
  "activeTools",
  "activeAgents",
  "activeHook",
  "usage",
  "contextUsage",
  "promptSuggestion",
];

function persistableMessages(messages: SessionState["messages"]): SessionState["messages"] {
  return messages.filter(
    (message) =>
      !message.kind ||
      (!TRANSIENT_PART_KINDS.has(message.kind) && !RETIRED_MESSAGE_KINDS.has(message.kind)),
  );
}

export function saveSessionState(sessionId: string, state: SessionState): void {
  try {
    const serializable: SerializableSessionState = {
      id: state.id,
      cwd: state.cwd,
      messages: persistableMessages(state.messages),
      pendingPermission: state.pendingPermission,
      isStreaming: state.isStreaming,
      resolvedActions: state.resolvedActions || [],
      agentState: state.agentState,
      receivedAuthoritativeState: state.receivedAuthoritativeState,
      terminal: state.terminal,
      epoch: state.epoch,
    };

    const key = `${SESSION_KEY_PREFIX}${sessionId}`;
    localStorage.setItem(key, JSON.stringify(serializable));

    // Update session IDs list
    const currentIds = getAllSessionIds();
    if (!currentIds.includes(sessionId)) {
      localStorage.setItem(SESSION_IDS_KEY, JSON.stringify([...currentIds, sessionId]));
    }
  } catch (error) {
    // Quota exceeded or other error
    console.error("[session-persistence] Failed to save session:", error);
  }
}

export function loadSessionState(sessionId: string): SessionState | null {
  try {
    const key = `${SESSION_KEY_PREFIX}${sessionId}`;
    const json = localStorage.getItem(key);
    if (!json) return null;

    const parsed = JSON.parse(json) as SerializableSessionState;
    for (const field of RETIRED_SESSION_FIELDS) Reflect.deleteProperty(parsed as object, field);

    // Everything after the spread is an activity claim, and localStorage has
    // no standing to make one: a reload used to resurrect a "busy" session
    // whose work had long since finished, spinner and all. Conversation text
    // and identity come back from disk; what the session is *doing* comes
    // only from the server, via the live-session reply.
    return {
      ...parsed,
      messages: persistableMessages(parsed.messages ?? []),
      resolvedActions: parsed.resolvedActions || [],
      isStreaming: false,
      pendingPermission: null,
      agentState: null,
      receivedAuthoritativeState: false,
    };
  } catch (error) {
    console.error("[session-persistence] Failed to load session:", error);
    return null;
  }
}

export function clearSessionState(sessionId: string): void {
  try {
    const key = `${SESSION_KEY_PREFIX}${sessionId}`;
    localStorage.removeItem(key);

    // Remove from session IDs list
    const currentIds = getAllSessionIds();
    const filtered = currentIds.filter((id) => id !== sessionId);
    localStorage.setItem(SESSION_IDS_KEY, JSON.stringify(filtered));

    // Forget the replay cursor too. This is the choke point every removal
    // passes through, so pruning here is what stops reconnects from carrying
    // cursors for sessions that no longer exist.
    clearLastEventId(sessionId);
  } catch (error) {
    console.error("[session-persistence] Failed to clear session:", error);
  }
}

function clearLastEventId(sessionId: string): void {
  try {
    const stored = localStorage.getItem(LAST_EVENT_IDS_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored) as Record<string, number>;
    if (!(sessionId in parsed)) return;
    delete parsed[sessionId];
    localStorage.setItem(LAST_EVENT_IDS_KEY, JSON.stringify(parsed));
  } catch (error) {
    // A corrupt or unwritable cursor blob must never block a removal.
    console.error("[session-persistence] Failed to clear replay cursor:", error);
  }
}

export function getAllSessionIds(): string[] {
  try {
    const json = localStorage.getItem(SESSION_IDS_KEY);
    if (!json) return [];
    return JSON.parse(json) as string[];
  } catch (error) {
    console.error("[session-persistence] Failed to get session IDs:", error);
    return [];
  }
}

export function saveActiveSessionId(sessionId: string | null): void {
  try {
    if (sessionId === null) {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    } else {
      localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    }
  } catch (error) {
    console.error("[session-persistence] Failed to save active session ID:", error);
  }
}

export function loadActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch (error) {
    console.error("[session-persistence] Failed to load active session ID:", error);
    return null;
  }
}
