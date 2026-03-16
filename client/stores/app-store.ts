import { create } from "zustand";
import type { SessionListItem } from "../../server/protocol";

export type Message = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
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

export type ActiveTool = {
  toolName: string;
  startedAt: number;
  elapsedSeconds?: number;
  parentToolUseId?: string | null;
};

export type ActiveAgent = {
  description: string;
  taskType?: string;
  status: "running" | "completed" | "failed" | "stopped";
  toolCount?: number;
  tokenCount?: number;
  summary?: string;
};

export type UsageData = {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
  durationMs: number;
};

export type SessionState = {
  id: string;
  cwd: string;
  messages: Message[];
  pendingPermission: PendingPermission | null;
  isStreaming: boolean;
  currentStreamMessageId: string | null;
  activeToolStatus?: { toolName: string; description: string } | null;
  activeTools: Map<string, ActiveTool>;
  activeAgents: Map<string, ActiveAgent>;
  activeHook: { hookId: string; hookName: string } | null;
  usage: UsageData | null;
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

  // Tool Status (legacy)
  setActiveToolStatus: (
    sessionId: string,
    status: { toolName: string; description: string } | null,
  ) => void;
  addToolMessage: (sessionId: string, toolName: string, summary: string) => void;

  // Active Tool Management
  addActiveTool: (sessionId: string, toolUseId: string, tool: ActiveTool) => void;
  updateActiveTool: (sessionId: string, toolUseId: string, updates: Partial<ActiveTool>) => void;
  removeActiveTool: (sessionId: string, toolUseId: string) => void;

  // Active Agent Management
  addActiveAgent: (sessionId: string, taskId: string, agent: ActiveAgent) => void;
  updateActiveAgent: (sessionId: string, taskId: string, updates: Partial<ActiveAgent>) => void;
  completeActiveAgent: (
    sessionId: string,
    taskId: string,
    completion: Partial<ActiveAgent>,
  ) => void;

  // Cleanup
  clearActiveTools: (sessionId: string) => void;
  clearActiveAgents: (sessionId: string) => void;

  // Active Hook Management
  setActiveHook: (sessionId: string, hook: { hookId: string; hookName: string } | null) => void;

  // Usage
  updateUsage: (sessionId: string, usage: UsageData) => void;

  // Capabilities (shared across sessions)
  capabilities: Capabilities | null;
  setCapabilities: (capabilities: Capabilities) => void;

  // Permission mode (server-side setting)
  permissionMode: string;
  setPermissionMode: (mode: string) => void;

  // Global error (e.g., invalid cwd)
  globalError: string | null;
  setGlobalError: (error: string | null) => void;

  // Input draft (shared so QuickActions can fill it)
  inputDraft: string;
  setInputDraft: (draft: string) => void;

  // Session list for resume
  sessionList: SessionListItem[];
  setSessionList: (sessions: SessionListItem[]) => void;
  loadSessionHistory: (
    sessionId: string,
    messages: Array<{ id: string; role: string; content: string; timestamp: number }>,
  ) => void;
}

function updateSession(
  sessions: Map<string, SessionState>,
  sessionId: string,
  updater: (session: SessionState) => SessionState,
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
        activeToolStatus: null,
        activeTools: new Map(),
        activeAgents: new Map(),
        activeHook: null,
        usage: null,
      });
      return {
        sessions: next,
        activeSessionId: sessionId,
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
          state.activeSessionId === sessionId ? (ids[0] ?? null) : state.activeSessionId,
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
          messages: [...s.messages.slice(0, -1), { ...last, content: last.content + text }],
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

  setActiveToolStatus: (sessionId, status) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        activeToolStatus: status,
      })),
    })),

  addToolMessage: (sessionId, toolName, summary) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: `tool-${Date.now()}-${Math.random()}`,
            role: "tool" as const,
            toolName,
            content: summary,
            timestamp: Date.now(),
          },
        ],
      })),
    })),

  capabilities: null,
  setCapabilities: (capabilities) => set({ capabilities }),

  permissionMode: "default",
  setPermissionMode: (permissionMode) => set({ permissionMode }),

  globalError: null,
  setGlobalError: (globalError) => set({ globalError }),

  inputDraft: "",
  setInputDraft: (inputDraft) => set({ inputDraft }),

  sessionList: [],
  setSessionList: (sessions) => set({ sessionList: sessions }),
  loadSessionHistory: (sessionId, messages) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: m.timestamp,
        })),
      })),
    })),

  addActiveTool: (sessionId, toolUseId, tool) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => {
        const next = new Map(s.activeTools);
        next.set(toolUseId, tool);
        return { ...s, activeTools: next };
      }),
    })),

  updateActiveTool: (sessionId, toolUseId, updates) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => {
        const tool = s.activeTools.get(toolUseId);
        if (!tool) return s;
        const next = new Map(s.activeTools);
        next.set(toolUseId, { ...tool, ...updates });
        return { ...s, activeTools: next };
      }),
    })),

  removeActiveTool: (sessionId, toolUseId) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => {
        const next = new Map(s.activeTools);
        next.delete(toolUseId);
        return { ...s, activeTools: next };
      }),
    })),

  addActiveAgent: (sessionId, taskId, agent) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => {
        const next = new Map(s.activeAgents);
        next.set(taskId, agent);
        return { ...s, activeAgents: next };
      }),
    })),

  updateActiveAgent: (sessionId, taskId, updates) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => {
        const agent = s.activeAgents.get(taskId);
        if (!agent) return s;
        const next = new Map(s.activeAgents);
        next.set(taskId, { ...agent, ...updates });
        return { ...s, activeAgents: next };
      }),
    })),

  completeActiveAgent: (sessionId, taskId, completion) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => {
        const agent = s.activeAgents.get(taskId);
        if (!agent) return s;
        const next = new Map(s.activeAgents);
        next.set(taskId, { ...agent, ...completion });
        return { ...s, activeAgents: next };
      }),
    })),

  clearActiveTools: (sessionId) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        activeTools: new Map(),
      })),
    })),

  clearActiveAgents: (sessionId) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        activeAgents: new Map(),
      })),
    })),

  setActiveHook: (sessionId, hook) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        activeHook: hook,
      })),
    })),

  updateUsage: (sessionId, usage) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        usage,
      })),
    })),
}));
