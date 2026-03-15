import { create } from "zustand";

export type Message = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
};

export type PendingPermission = {
  requestId: string;
  tool: {
    name: string;
    parameters: Record<string, unknown>;
  };
};

export type Capabilities = {
  commands: string[];
  agents: string[];
  model: string;
};

export type SessionState = {
  id: string;
  cwd: string;
  messages: Message[];
  pendingPermission: PendingPermission | null;
  isStreaming: boolean;
  currentStreamMessageId: string | null;
};

type ConnectionState = "connecting" | "connected" | "disconnected";

interface AppState {
  // Connection
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;

  // Sessions
  sessions: Map<string, SessionState>;
  activeSessionId: string | null;

  addSession: (sessionId: string, cwd: string) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;

  // Messages
  addMessage: (sessionId: string, message: Message) => void;
  appendToLastAssistantMessage: (sessionId: string, text: string) => void;
  startStreamMessage: (sessionId: string, messageId: string, text: string) => void;

  // Streaming
  setStreaming: (sessionId: string, streaming: boolean) => void;

  // Permissions
  setPermission: (sessionId: string, permission: PendingPermission | null) => void;

  // Capabilities (shared across sessions)
  capabilities: Capabilities | null;
  setCapabilities: (capabilities: Capabilities) => void;

  // Global error (e.g., invalid cwd)
  globalError: string | null;
  setGlobalError: (error: string | null) => void;
}

function updateSession(
  sessions: Map<string, SessionState>,
  sessionId: string,
  updater: (session: SessionState) => SessionState
): Map<string, SessionState> {
  const session = sessions.get(sessionId);
  if (!session) return sessions;
  const next = new Map(sessions);
  next.set(sessionId, updater(session));
  return next;
}

export const useAppStore = create<AppState>((set) => ({
  connectionState: "connecting",
  setConnectionState: (connectionState) => set({ connectionState }),

  sessions: new Map(),
  activeSessionId: null,

  addSession: (sessionId, cwd) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.set(sessionId, {
        id: sessionId,
        cwd,
        messages: [],
        pendingPermission: null,
        isStreaming: false,
        currentStreamMessageId: null,
      });
      return {
        sessions: next,
        activeSessionId: state.activeSessionId ?? sessionId,
      };
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.delete(sessionId);
      const ids = [...next.keys()];
      return {
        sessions: next,
        activeSessionId:
          state.activeSessionId === sessionId
            ? ids[0] ?? null
            : state.activeSessionId,
      };
    }),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  addMessage: (sessionId, message) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        messages: [...s.messages, message],
      })),
    })),

  appendToLastAssistantMessage: (sessionId, text) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => {
        const last = s.messages[s.messages.length - 1];
        if (!last || last.id !== s.currentStreamMessageId) return s;
        return {
          ...s,
          messages: [
            ...s.messages.slice(0, -1),
            { ...last, content: last.content + text },
          ],
        };
      }),
    })),

  startStreamMessage: (sessionId, messageId, text) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        currentStreamMessageId: messageId,
        messages: [
          ...s.messages,
          {
            id: messageId,
            role: "assistant" as const,
            content: text,
            timestamp: Date.now(),
          },
        ],
      })),
    })),

  setStreaming: (sessionId, streaming) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        isStreaming: streaming,
        ...(streaming ? {} : { currentStreamMessageId: null }),
      })),
    })),

  setPermission: (sessionId, permission) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        pendingPermission: permission,
      })),
    })),

  capabilities: null,
  setCapabilities: (capabilities) => set({ capabilities }),

  globalError: null,
  setGlobalError: (globalError) => set({ globalError }),
}));
