import { create } from "zustand";
import type { ContentBlock } from "../../server/protocol";
import {
  clearSessionState,
  getAllSessionIds,
  loadActiveSessionId,
  loadSessionState,
  saveActiveSessionId,
  saveSessionState,
} from "../services/session-persistence";

export type CompactMetadata = {
  trigger: "manual" | "auto";
  preTokens?: number;
  postTokens?: number;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  contentBlocks?: ContentBlock[];
  agentLabel?: string;
  agentDescription?: string;
  kind?: "compact_boundary" | "permission_denied";
  compactMetadata?: CompactMetadata;
};

/** One choice the terminal is offering, in its own wording (server-supplied). */
export type PermissionOption = {
  id: string;
  label: string;
  keystroke: string;
};

export type PendingPermission = {
  requestId: string;
  tool: {
    name: string;
    /**
     * Parsed screen text (`{text, description}`) since #29 — while claude is
     * blocked the transcript holds nothing about the pending call, so the
     * terminal's screen is the only source. There are no structured tool
     * arguments to key on any more.
     */
    parameters: Record<string, unknown>;
  };
  /** Empty (or absent) means the screen could not be parsed: offer Cancel only. */
  options?: PermissionOption[];
};

/**
 * What the server knows about a live session that the card must show honestly.
 *
 * `gated: false` means claude runs in that pane with no permission gate: it will
 * not stop to ask before acting. The badge is the whole safeguard — the composer
 * stays enabled, because driving such a pane is the owner's own accepted risk
 * (Decision H4).
 */
export type SessionDescriptorFlags = {
  origin: "self" | "foreign";
  drivable: boolean;
  readable: boolean;
  gated: boolean;
  /**
   * Which agent runs in that pane, in herdr's own wording. Absent when herdr
   * cannot tell — never defaulted to claude, since guessing would put the wrong
   * name on a card.
   */
  agent?: string;
};

export type ModelInfo = {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsFastMode?: boolean;
  supportsAdaptiveThinking?: boolean;
  contextLength?: number;
};

export type AccountInfo = {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
};

export type AgentInfo = {
  name: string;
  description?: string;
  allowedTools?: string[];
  icon?: string;
};

export type CommandInfo = {
  name: string;
  description?: string;
  category?: string;
};

export type Capabilities = {
  commands: CommandInfo[];
  agents: AgentInfo[];
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
  /**
   * `tool_use_id` of the Task tool that spawned this subagent. Sub-tools
   * fired by the agent carry this value as their `parent_tool_use_id`, so we
   * group on it in the UI.
   */
  toolUseId?: string;
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
  terminalReason?: import("../services/tool-events").TerminalReason;
};

export type ContextUsage = {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
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
  contextUsage: ContextUsage | null;
  promptSuggestion: string | null;
  resolvedActions: ResolvedAction[];
  agentState: "idle" | "running" | "requires_action" | null;
  receivedAuthoritativeState: boolean;
  permissionMode?: string;
  // Present only on sessions backed by a live terminal session (herdr).
  // `ready` flips true on `terminal_created`; sends are gated until then.
  terminal?: { ready: boolean };
  /** Server-supplied capability flags; absent until the session has been listed. */
  descriptor?: SessionDescriptorFlags;
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

export type ScreenName = "sessions" | "agents" | "chat" | "commands" | "settings";

interface AppState {
  // Connection
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;

  // Sessions
  sessions: Map<string, SessionState>;
  activeSessionId: string | null;

  addSession: (sessionId: string, cwd: string, terminal?: { ready: boolean }) => void;
  /**
   * Moves an optimistic card onto the session id the server assigned. Idempotent:
   * a replayed `terminal_created` finds no card under the old key and does
   * nothing, rather than resurrecting one.
   */
  rekeySession: (fromId: string, toId: string) => void;
  /**
   * Creates or refreshes a card from the server's session list, WITHOUT making
   * it the active session — the list arrives on every reconnect and must not
   * yank the user out of the conversation they are reading.
   */
  upsertListedSession: (
    descriptor: SessionDescriptorFlags & { sessionId: string; cwd: string },
  ) => void;
  setTerminalReady: (sessionId: string, ready: boolean) => void;
  setSdkSessionId: (sessionId: string, sdkSessionId: string) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;

  // Messages
  addMessage: (sessionId: string, message: Message) => void;
  removeMessage: (sessionId: string, messageId: string) => void;
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
  addToolMessage: (
    sessionId: string,
    toolName: string,
    summary: string,
    attribution?: { agentLabel: string; agentDescription: string },
  ) => void;

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
  setContextUsage: (sessionId: string, contextUsage: ContextUsage | null) => void;

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
  setSessionPermissionMode: (sessionId: string, mode: string | undefined) => void;

  // Global error (e.g., invalid cwd)
  globalError: string | null;
  setGlobalError: (error: string | null) => void;

  // Input draft (shared so QuickActions can fill it)
  inputDraft: string;
  setInputDraft: (draft: string) => void;

  // Resolved actions
  addResolvedAction: (sessionId: string, action: ResolvedAction) => void;

  // Agent state management
  setAgentState: (sessionId: string, state: "idle" | "running" | "requires_action" | null) => void;
  setReceivedAuthoritativeState: (sessionId: string, received: boolean) => void;

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

  /**
   * Agent kinds this machine can launch, from server_config (#31). Empty until
   * the server answers — which reads as "offer the plain New session button",
   * not as "nothing can be started".
   */
  availableAgents: string[];
  setAvailableAgents: (kinds: string[]) => void;

  // Ember UI screen state
  activeScreen: ScreenName;
  setActiveScreen: (screen: ScreenName) => void;
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

  addSession: (sessionId, cwd, terminal) =>
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
        contextUsage: null,
        promptSuggestion: null,
        resolvedActions: [],
        agentState: null,
        receivedAuthoritativeState: false,
        permissionMode: undefined,
        terminal,
      });
      return {
        sessions: next,
        activeSessionId: sessionId,
      };
    }),

  rekeySession: (fromId, toId) =>
    set((state) => {
      if (fromId === toId) return state;
      const session = state.sessions.get(fromId);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.delete(fromId);
      const existing = next.get(toId);
      next.set(
        toId,
        existing ? { ...existing, cwd: existing.cwd || session.cwd } : { ...session, id: toId },
      );
      clearSessionState(fromId);
      return {
        sessions: next,
        activeSessionId: state.activeSessionId === fromId ? toId : state.activeSessionId,
      };
    }),

  upsertListedSession: (descriptor) =>
    set((state) => {
      const { sessionId, cwd, ...flags } = descriptor;
      const next = new Map(state.sessions);
      const existing = next.get(sessionId);
      next.set(sessionId, {
        ...(existing ?? {
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
          contextUsage: null,
          promptSuggestion: null,
          resolvedActions: [],
          agentState: null,
          receivedAuthoritativeState: false,
          permissionMode: undefined,
        }),
        cwd: existing?.cwd || cwd,
        terminal: { ready: true },
        descriptor: flags,
      });
      return { sessions: next };
    }),

  setTerminalReady: (sessionId, ready) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        terminal: { ready },
      })),
    })),

  setSdkSessionId: (sessionId, sdkSessionId) =>
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(sessionId, { ...session, sdkSessionId });
      return { sessions: next };
    }),

  removeSession: (sessionId) => {
    clearSessionState(sessionId);
    set((state) => {
      const next = new Map(state.sessions);
      next.delete(sessionId);
      const ids = [...next.keys()];
      return {
        sessions: next,
        activeSessionId:
          state.activeSessionId === sessionId ? (ids[0] ?? null) : state.activeSessionId,
      };
    });
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  addMessage: (sessionId, message) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        messages: [...s.messages, message],
      })),
    })),

  /**
   * Takes a message back out of the transcript. Only for a bubble that turned
   * out never to have happened — an optimistic user message the server refused
   * to send must not be left on screen claiming it was sent.
   */
  removeMessage: (sessionId, messageId) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        messages: s.messages.filter((m) => m.id !== messageId),
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

  addToolMessage: (sessionId, toolName, summary, attribution) =>
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
            ...(attribution
              ? {
                  agentLabel: attribution.agentLabel,
                  agentDescription: attribution.agentDescription,
                }
              : {}),
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

  selectedModel: "",
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  selectedEffort: null,
  setSelectedEffort: (selectedEffort) => set({ selectedEffort }),

  permissionMode: "default",
  setPermissionMode: (permissionMode) => set({ permissionMode }),
  setSessionPermissionMode: (sessionId, mode) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        permissionMode: mode,
      })),
    })),

  globalError: null,
  setGlobalError: (globalError) => set({ globalError }),

  inputDraft: "",
  setInputDraft: (inputDraft) => set({ inputDraft }),

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

  setContextUsage: (sessionId, contextUsage) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        contextUsage,
      })),
    })),

  addResolvedAction: (sessionId, action) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        resolvedActions: [...s.resolvedActions, action],
      })),
    })),

  setAgentState: (sessionId, state) =>
    set((appState) => ({
      sessions: updateSession(appState.sessions, sessionId, (s) => {
        const updates: Partial<SessionState> = {
          agentState: state,
          receivedAuthoritativeState: true,
        };
        // Sync isStreaming based on agent state
        if (state === "idle") {
          updates.isStreaming = false;
        } else if (state === "running") {
          updates.isStreaming = true;
        }
        return { ...s, ...updates };
      }),
    })),

  setReceivedAuthoritativeState: (sessionId, received) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        receivedAuthoritativeState: received,
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

  availableAgents: [],
  setAvailableAgents: (availableAgents) => set({ availableAgents }),

  activeScreen: "chat",
  setActiveScreen: (activeScreen) => set({ activeScreen }),
}));
