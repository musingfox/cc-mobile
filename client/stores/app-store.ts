import { create } from "zustand";
import type { ContentBlock, SessionListItem } from "../../server/protocol";
import {
  clearSessionState,
  getAllSessionIds,
  loadActiveSessionId,
  loadSessionState,
  saveActiveSessionId,
  saveSessionState,
} from "../services/session-persistence";

export type Message = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  contentBlocks?: ContentBlock[];
};

export type PendingPermission = {
  requestId: string;
  tool: {
    name: string;
    parameters: Record<string, unknown>;
  };
};

export type ModelInfo = {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsFastMode?: boolean;
  supportsAdaptiveThinking?: boolean;
};

export type AccountInfo = {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
};

export type Capabilities = {
  commands: string[];
  agents: string[];
  model: string;
  models?: ModelInfo[];
  accountInfo?: AccountInfo;
};

export type ActiveTool = {
  toolName: string;
  startedAt: number;
  elapsedSeconds?: number;
  parentToolUseId?: string | null;
  input?: Record<string, unknown>;
};

export type ActiveAgent = {
  description: string;
  taskType?: string;
  status: "running" | "completed" | "failed" | "stopped";
  toolCount?: number;
  tokenCount?: number;
  summary?: string;
};

export type ResolvedAction = {
  id: string;
  timestamp: number;
} & (
  | {
      type: "permission";
      toolName: string;
      parameters: Record<string, unknown>;
      resolution: "approved" | "denied" | "answered";
      answer?: string;
    }
  | {
      type: "activity";
      tools: Array<{ toolName: string; detail?: string; elapsed?: string }>;
      agents: Array<{ description: string; toolCount?: number; tokenCount?: number }>;
    }
);

export type UsageData = {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
  durationMs: number;
};

export type RateLimitInfo = {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
  overageStatus?: string;
  overageResetsAt?: number;
  isUsingOverage?: boolean;
};

export type SessionState = {
  id: string;
  cwd: string;
  sdkSessionId: string | null;
  messages: Message[];
  pendingPermission: PendingPermission | null;
  isStreaming: boolean;
  currentStreamMessageId: string | null;
  activeToolStatus?: { toolName: string; description: string } | null;
  activeTools: Map<string, ActiveTool>;
  activeAgents: Map<string, ActiveAgent>;
  activeHook: { hookId: string; hookName: string } | null;
  usage: UsageData | null;
  promptSuggestion: string | null;
  resolvedActions: ResolvedAction[];
};

type ConnectionState = "connecting" | "connected" | "disconnected";

export type DirectoryListing = {
  path: string;
  entries: Array<{ name: string; path: string }>;
  parent: string | null;
};

export type ServerPaths = {
  allowedRoots: string[] | null;
  homeDirectory: string;
};

interface AppState {
  // Connection
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;

  // Sessions
  sessions: Map<string, SessionState>;
  activeSessionId: string | null;

  addSession: (sessionId: string, cwd: string) => void;
  setSdkSessionId: (sessionId: string, sdkSessionId: string) => void;
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

  // Rate limit info (global, not per-session)
  rateLimitInfo: RateLimitInfo | null;
  setRateLimitInfo: (info: RateLimitInfo) => void;

  // Prompt suggestion (per-session)
  setPromptSuggestion: (sessionId: string, suggestion: string | null) => void;

  // Model/Effort selection (server-side)
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  selectedEffort: string | null;
  setSelectedEffort: (effort: string | null) => void;

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

  // Resolved actions
  addResolvedAction: (sessionId: string, action: ResolvedAction) => void;

  // Session persistence
  persistSessionState: (sessionId: string) => void;
  persistAllSessions: () => void;
  restoreAllSessions: () => void;

  // Directory browsing
  directoryListing: DirectoryListing | null;
  isLoadingDirectories: boolean;
  serverPaths: ServerPaths | null;
  setDirectoryListing: (listing: DirectoryListing | null) => void;
  setIsLoadingDirectories: (loading: boolean) => void;
  setServerPaths: (paths: ServerPaths) => void;
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
        sdkSessionId: null,
        messages: [],
        pendingPermission: null,
        isStreaming: false,
        currentStreamMessageId: null,
        activeToolStatus: null,
        activeTools: new Map(),
        activeAgents: new Map(),
        activeHook: null,
        usage: null,
        promptSuggestion: null,
        resolvedActions: [],
      });
      return {
        sessions: next,
        activeSessionId: sessionId,
      };
    }),

  setSdkSessionId: (sessionId, sdkSessionId) =>
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(sessionId, { ...session, sdkSessionId });
      return { sessions: next };
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

  rateLimitInfo: null,
  setRateLimitInfo: (rateLimitInfo) => set({ rateLimitInfo }),

  setPromptSuggestion: (sessionId, suggestion) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        promptSuggestion: suggestion,
      })),
    })),

  selectedModel: "claude-sonnet-4-6",
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  selectedEffort: null,
  setSelectedEffort: (selectedEffort) => set({ selectedEffort }),

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

  addResolvedAction: (sessionId, action) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        resolvedActions: [...s.resolvedActions, action],
      })),
    })),

  persistSessionState: (sessionId) => {
    const state = useAppStore.getState();
    const session = state.sessions.get(sessionId);
    if (session) {
      saveSessionState(sessionId, session);
    }
  },

  persistAllSessions: () => {
    const state = useAppStore.getState();
    // Save all sessions
    state.sessions.forEach((session, sessionId) => {
      saveSessionState(sessionId, session);
    });
    // Save active session ID
    saveActiveSessionId(state.activeSessionId);
  },

  restoreAllSessions: () => {
    const sessionIds = getAllSessionIds();
    const restoredSessions = new Map<string, SessionState>();

    for (const sessionId of sessionIds) {
      const session = loadSessionState(sessionId);
      if (session) {
        restoredSessions.set(sessionId, session);
      } else {
        // Clean up invalid entries
        clearSessionState(sessionId);
      }
    }

    const activeSessionId = loadActiveSessionId();
    // Only set active if it exists in restored sessions
    const validActiveSessionId =
      activeSessionId && restoredSessions.has(activeSessionId) ? activeSessionId : null;

    set({
      sessions: restoredSessions,
      activeSessionId: validActiveSessionId,
    });
  },

  directoryListing: null,
  isLoadingDirectories: false,
  serverPaths: null,
  setDirectoryListing: (directoryListing) => set({ directoryListing }),
  setIsLoadingDirectories: (isLoadingDirectories) => set({ isLoadingDirectories }),
  setServerPaths: (serverPaths) => set({ serverPaths }),
}));
