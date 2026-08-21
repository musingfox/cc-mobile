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

/** The earlier of two file positions, where either may be absent. */
function earliestSeq(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

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
  kind?: "compact_boundary" | "permission_denied" | "thinking" | "tool_use" | "tool_result";
  compactMetadata?: CompactMetadata;
  /** From transcript record for history / dedup */
  recordId?: string;
  seq?: number;
  /** Index of this part within the source record's projected parts. */
  blockIndex?: number;
  /** Wire stop reason on a text part (`stop_reason` / `stopReason`). */
  stopReason?: string;
  toolUseId?: string;
};

/** One choice the terminal is offering, in its own wording (server-supplied). */
export type PermissionOption = {
  id: string;
  label: string;
  /**
   * Absent on omp, whose options are chosen by arrow keys rather than by one
   * key (#33). Nothing here reads it — an answer names the `id` and the server
   * works out what to press — so it rides along purely as disclosure.
   */
  keystroke?: string;
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
  /**
   * The pane's own title, as herdr reports it. Absent when herdr has none —
   * a row must then show what it actually knows (the pane id) rather than
   * name the session itself.
   */
  title?: string;
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
  argumentHint?: string;
};

/** Per-session command/agent list. `undefined` on the session means never asked. */
export type SessionCapabilitiesState =
  | { status: "loading"; sentAt: number }
  | { status: "ready"; commands: CommandInfo[]; agents: AgentInfo[] }
  | { status: "unavailable"; reason: "unsupported" | "failed" };

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
  // Present only on sessions backed by a live terminal session (herdr).
  // `ready` flips true on `terminal_created`; sends are gated until then.
  terminal?: { ready: boolean };
  /** Server-supplied capability flags; absent until the session has been listed. */
  descriptor?: SessionDescriptorFlags;
  /** Current transcript file identity (from epochOf). */
  epoch?: string;
  /** Retired epochs (replays ignored). */
  retiredEpochs?: Set<string>;
  /** Paging cursor for history load more (client held). */
  pagingCursor?: TranscriptCursor | null;
  /**
   * The history page request currently in flight, with the client-clock moment
   * it went out. Presence is the in-flight guard — a double-tap or a second
   * scroll-to-top issues one request — and the timestamp separates the
   * pre-transcript log (older) from a message being sent right now (newer).
   */
  transcriptPageRequest?: { sentAt: number } | null;
  /**
   * Command/agent inventory for this session. Absent until the picker asks;
   * never a machine-wide list.
   */
  capabilities?: SessionCapabilitiesState;
};

/** Where a history page stops, and which transcript file that position is in. */
export type TranscriptCursor = { epoch: string; seq: number; recordId: string };

/** One delivery of transcript-derived content, from any of the three sources. */
export type TranscriptApply = {
  /**
   * The file this content came from, as the deliverer reported it. `null`,
   * `undefined` and `""` all mean "no claim" and are treated identically —
   * a delivery that cannot say which file it read never erases anything.
   */
  epoch?: string | null;
  /** Already rendered to bubbles by the caller; the store never parses records. */
  messages: Message[];
  /**
   * The next backward cursor, when this delivery was a page. `undefined` leaves
   * the stored cursor alone (a live chunk says nothing about paging); `null`
   * means the page reached the beginning of the conversation.
   */
  nextBefore?: TranscriptCursor | null;
  /**
   * Discard local-only messages (no `recordId`) older than this client-clock
   * timestamp. Set to the moment the page request went out, so a bubble the
   * user is sending right now survives while the pre-transcript log gives way.
   */
  discardLocalBefore?: number;
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

  setSessionCapabilities: (
    sessionId: string,
    capabilities: SessionCapabilitiesState | null,
  ) => void;

  // Prompt suggestion (per-session)
  setPromptSuggestion: (sessionId: string, suggestion: string | null) => void;

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

  /**
   * The one door transcript-derived content comes through, whether it arrived
   * live, in a history page, or in a reconnect replay. Keys by `recordId`,
   * orders by `seq`, and owns the epoch rules — see the implementation for the
   * branch order, which is the contract.
   */
  applyTranscriptMessages: (sessionId: string, apply: TranscriptApply) => void;
  /** Marks a history page request in flight, or clears it when one resolves. */
  setTranscriptPageRequest: (sessionId: string, request: { sentAt: number } | null) => void;

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

  setSessionCapabilities: (sessionId, capabilities) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => {
        if (capabilities === null) {
          const { capabilities: _dropped, ...rest } = session;
          return rest;
        }
        return { ...session, capabilities };
      }),
    })),

  setPromptSuggestion: (sessionId, suggestion) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        promptSuggestion: suggestion,
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

  setTranscriptPageRequest: (sessionId, request) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (session) => ({
        ...session,
        transcriptPageRequest: request,
      })),
    })),

  /**
   * Transcript-derived content, from whichever of the three deliverers brought
   * it: the live tail, a history page, or a reconnect replay. The branch order
   * below is the contract, and it is deliberate.
   */
  applyTranscriptMessages: (sessionId, apply) =>
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;

      // "This content has no file identity" has three spellings on the wire —
      // absent, null, and "" — and they mean one thing. None of them erases
      // anything: an agent that exits makes herdr report an explicitly null
      // session, and that is not the user clearing their conversation.
      const incoming = typeof apply.epoch === "string" && apply.epoch !== "" ? apply.epoch : null;
      const current = session.epoch;
      const retired = session.retiredEpochs ?? new Set<string>();

      // A replay of a conversation this session has already left must not drag
      // it back. The server's event buffer holds up to 500 pre-rotation chunks
      // per session and nothing prunes them, so a reconnect will re-deliver
      // them; they are dropped here, not merged and not treated as a rotation.
      if (incoming !== null && retired.has(incoming)) return state;

      // The one transition that wipes: from one real file to a *different* real
      // file. Adopting a first epoch is not a reset, and neither is losing one.
      const isReset = incoming !== null && current !== undefined && incoming !== current;

      const nextRetired = isReset ? new Set(retired).add(current as string) : retired;

      // Local-only messages (no `recordId`) are the pre-transcript log. They
      // give way to the file in one batch, but only those older than the moment
      // the request went out — a bubble the user is sending right now is not
      // part of the history this page is replacing.
      const kept = isReset
        ? []
        : session.messages.filter(
            (message) =>
              message.recordId !== undefined ||
              apply.discardLocalBefore === undefined ||
              message.timestamp >= apply.discardLocalBefore,
          );

      const messages = [...kept];
      const indexOfRecord = new Map<string, number>();
      const keyOf = (message: { recordId?: string; blockIndex?: number }) =>
        message.recordId === undefined ? undefined : `${message.recordId}#${message.blockIndex ?? 0}`;
      messages.forEach((message, index) => {
        const key = keyOf(message);
        if (key !== undefined) indexOfRecord.set(key, index);
      });

      for (const arrival of apply.messages) {
        const key = keyOf(arrival);
        const at = key === undefined ? undefined : indexOfRecord.get(key);
        if (at === undefined) {
          if (key !== undefined) indexOfRecord.set(key, messages.length);
          messages.push(arrival);
          continue;
        }
        // The same record delivered twice. Body follows the newer arrival —
        // claude does re-write a record, only ever adding fields. Position
        // follows the earlier one: a record re-appended thousands of lines
        // later is still the record it was, and its first position is the true
        // one. The stored id survives so React keeps the same DOM node.
        const existing = messages[at];
        messages[at] = {
          ...existing,
          ...arrival,
          id: existing.id,
          ...(earliestSeq(existing.seq, arrival.seq) === undefined
            ? {}
            : { seq: earliestSeq(existing.seq, arrival.seq) }),
        };
      }

      // File order, never arrival order. A message with no `seq` has no
      // position in any file, so it sorts below everything the transcript
      // placed; the sort is stable, so equal keys keep the order they had.
      messages.sort(
        (a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER),
      );

      // A reset invalidates the cursor (it points into the file we just left),
      // but this very delivery may be the page that supplies the new one.
      const pagingCursor =
        apply.nextBefore !== undefined
          ? apply.nextBefore
          : isReset
            ? null
            : session.pagingCursor;

      const next = new Map(state.sessions);
      next.set(sessionId, {
        ...session,
        messages,
        ...(incoming !== null ? { epoch: incoming } : {}),
        retiredEpochs: nextRetired,
        pagingCursor,
      });
      return { sessions: next };
    }),
}));
