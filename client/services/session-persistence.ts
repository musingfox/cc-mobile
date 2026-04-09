import type { ResolvedAction, SessionState } from "../stores/app-store";

// localStorage keys
const SESSION_KEY_PREFIX = "ccm:session:";
const ACTIVE_SESSION_KEY = "ccm:active-session";
const SESSION_IDS_KEY = "ccm:session-ids";

interface SerializableSessionState {
  id: string;
  cwd: string;
  sdkSessionId: string | null;
  messages: SessionState["messages"];
  pendingPermission: SessionState["pendingPermission"];
  isStreaming: boolean;
  currentStreamMessageId: string | null;
  activeToolStatus: SessionState["activeToolStatus"];
  activeTools: [string, SessionState["activeTools"] extends Map<string, infer T> ? T : never][];
  activeAgents: [string, SessionState["activeAgents"] extends Map<string, infer T> ? T : never][];
  activeHook: SessionState["activeHook"];
  usage: SessionState["usage"];
  promptSuggestion: string | null;
  resolvedActions: ResolvedAction[];
  agentState: "idle" | "running" | "requires_action" | null;
  receivedAuthoritativeState: boolean;
}

export function saveSessionState(sessionId: string, state: SessionState): void {
  try {
    const serializable: SerializableSessionState = {
      id: state.id,
      cwd: state.cwd,
      sdkSessionId: state.sdkSessionId,
      messages: state.messages,
      pendingPermission: state.pendingPermission,
      isStreaming: state.isStreaming,
      currentStreamMessageId: state.currentStreamMessageId,
      activeToolStatus: state.activeToolStatus,
      activeTools: Array.from(state.activeTools.entries()),
      activeAgents: Array.from(state.activeAgents.entries()),
      activeHook: state.activeHook,
      usage: state.usage,
      promptSuggestion: state.promptSuggestion,
      resolvedActions: state.resolvedActions || [],
      agentState: state.agentState,
      receivedAuthoritativeState: state.receivedAuthoritativeState,
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

    // Deserialize Maps and provide defaults for new fields
    return {
      ...parsed,
      sdkSessionId: parsed.sdkSessionId ?? null,
      activeTools: new Map(parsed.activeTools),
      activeAgents: new Map(parsed.activeAgents),
      resolvedActions: parsed.resolvedActions || [],
      agentState: parsed.agentState ?? null,
      receivedAuthoritativeState: parsed.receivedAuthoritativeState ?? false,
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
  } catch (error) {
    console.error("[session-persistence] Failed to clear session:", error);
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
