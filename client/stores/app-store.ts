import { create } from "zustand";
import type { PromptKind } from "../../server/protocol";
import { loadDraft, saveDraft } from "../services/draft-persistence";
import {
  clearSessionState,
  getAllSessionIds,
  loadActiveSessionId,
  loadSessionState,
  saveActiveSessionId,
  saveSessionState,
} from "../services/session-persistence";

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
  kind?: "thinking" | "tool_use" | "tool_result" | "system_note";
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

export type { PromptKind };

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
  /**
   * Which of the two the terminal is waiting for, when the server could read it
   * off the screen. Absent whenever the screen did not parse — no kind is the
   * honest answer there, not `"permission"`.
   */
  promptKind?: PromptKind;
  /**
   * When the server will press `esc` on this prompt by itself, on this device's
   * clock (the server sends a duration, not a time). Absent when it will not:
   * a pane cc-mobile did not launch, a question, or a countdown the server
   * froze because the connection dropped.
   */
  deadline?: number;
};

/**
 * The server could not parse the screen and offers only its synthetic Cancel
 * (Esc). One test for the card and for every announcement of it, so a toast
 * never names a kind the card refuses to claim.
 */
export function isUnreadablePrompt(pending: PendingPermission): boolean {
  return !pending.options?.length || pending.options.every((option) => option.id === "cancel");
}

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
  /**
   * Why `readable` is false; absent when it is true. `"pending"` means the
   * transcript is not written yet and a message will start it, `"unsupported"`
   * means this build cannot read that pane back at all — the difference between
   * an empty screen that is waiting for you and one that will stay empty.
   */
  unreadableReason?: "pending" | "unsupported";
  /** Which herdr daemon owns the pane; absent from an older server. */
  side?: "cockpit" | "hangar";
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

export type ResolvedAction = {
  id: string;
  timestamp: number;
  type: "permission";
  toolName: string;
  parameters: Record<string, unknown>;
  resolution: "approved" | "denied" | "answered";
  answer?: string;
};

export type SessionState = {
  id: string;
  cwd: string;
  messages: Message[];
  pendingPermission: PendingPermission | null;
  isStreaming: boolean;
  resolvedActions: ResolvedAction[];
  agentState: "idle" | "running" | "requires_action" | null;
  receivedAuthoritativeState: boolean;
  // Present only on sessions backed by a live terminal session (herdr).
  // `ready` flips true on `terminal_created`; sends are gated until then.
  terminal?: { ready: boolean };
  /** Server-supplied capability flags; absent until the session has been listed. */
  descriptor?: SessionDescriptorFlags;
  /**
   * The agent kind this phone asked for when it started the session — a fact,
   * not a guess, so it can name the agent until herdr's own detection
   * (`descriptor.agent`, read only at listing time) catches up.
   */
  launchedKind?: string;
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

/**
 * One launch profile the server offered, as it travels on the wire. There is no
 * `args` field and there must never be one: which argv a profile expands to is
 * the server's own business, and the phone only ever names the profile by `id`.
 * `kind` stays a plain string for the same reason `availableAgents` does — the
 * launchable-kind enum lives on the server.
 */
export type AgentProfile = {
  id: string;
  label: string;
  kind: string;
};

export type HerdrStatus = {
  cockpit: { online: boolean };
  hangar?: { name: string; online: boolean };
};

export type ScreenName = "sessions" | "agents" | "chat" | "commands" | "settings";

interface AppState {
  // Connection
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
  herdrStatus: HerdrStatus | null;
  setHerdrStatus: (status: HerdrStatus | null) => void;

  // Sessions
  sessions: Map<string, SessionState>;
  activeSessionId: string | null;

  addSession: (
    sessionId: string,
    cwd: string,
    terminal?: { ready: boolean },
    launchedKind?: string,
  ) => void;
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
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string) => void;

  // Messages
  addMessage: (sessionId: string, message: Message) => void;
  removeMessage: (sessionId: string, messageId: string) => void;

  // Streaming
  setStreaming: (sessionId: string, streaming: boolean) => void;

  // Permissions
  setPermission: (sessionId: string, permission: PendingPermission | null) => void;

  setSessionCapabilities: (
    sessionId: string,
    capabilities: SessionCapabilitiesState | null,
  ) => void;

  // Global error (e.g., invalid cwd)
  globalError: string | null;
  setGlobalError: (error: string | null) => void;

  /**
   * The active session's composer text, shared so QuickActions can fill it.
   * Each change is saved under that session at once rather than debounced:
   * iOS evicts a backgrounded PWA without a moment to flush.
   */
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
   * live, in a history page, or in a reconnect replay. Keys by `${recordId}#${blockIndex ?? 0}`,
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

  /**
   * herdr's integration state ("current" | "outdated") for each kind in
   * `availableAgents`. `null` means the server could not ask herdr, so that
   * list is PATH-only; empty until the server answers.
   */
  agentIntegrations: Record<string, string> | null;
  setAgentIntegrations: (states: Record<string, string> | null) => void;

  /**
   * Launch profiles this server offers, from server_config. Empty until the
   * server answers, and a config frame that carries no profile list leaves the
   * remembered one alone.
   */
  agentProfiles: AgentProfile[];
  setAgentProfiles: (profiles: AgentProfile[]) => void;

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
  herdrStatus: null,
  setHerdrStatus: (herdrStatus) => set({ herdrStatus }),

  sessions: new Map(),
  activeSessionId: null,

  addSession: (sessionId, cwd, terminal, launchedKind) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.set(sessionId, {
        id: sessionId,
        cwd,
        messages: [],
        pendingPermission: null,
        isStreaming: false,
        resolvedActions: [],
        agentState: null,
        receivedAuthoritativeState: false,
        terminal,
        ...(launchedKind ? { launchedKind } : {}),
      });
      return {
        sessions: next,
        activeSessionId: sessionId,
        inputDraft: "",
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
        existing
          ? {
              ...existing,
              cwd: existing.cwd || session.cwd,
              launchedKind: existing.launchedKind ?? session.launchedKind,
            }
          : { ...session, id: toId },
      );
      const draft = loadDraft(fromId);
      if (draft) saveDraft(toId, draft);
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
          messages: [],
          pendingPermission: null,
          isStreaming: false,
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

  removeSession: (sessionId) => {
    clearSessionState(sessionId);
    set((state) => {
      const next = new Map(state.sessions);
      next.delete(sessionId);
      // Never a survivor in its place: the next session in the Map is any live
      // pane on the machine, and a composer silently pointed at it sends the
      // user's next prompt to an agent they did not pick.
      return {
        sessions: next,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    });
  },

  setActiveSession: (sessionId) =>
    set({ activeSessionId: sessionId, inputDraft: loadDraft(sessionId) }),

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

  setStreaming: (sessionId, streaming) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        isStreaming: streaming,
      })),
    })),

  setPermission: (sessionId, permission) =>
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        pendingPermission: permission,
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

  globalError: null,
  setGlobalError: (globalError) => set({ globalError }),

  inputDraft: "",
  setInputDraft: (inputDraft) => {
    const { activeSessionId } = useAppStore.getState();
    if (activeSessionId) saveDraft(activeSessionId, inputDraft);
    set({ inputDraft });
  },

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
      inputDraft: validActiveSessionId ? loadDraft(validActiveSessionId) : "",
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

  agentIntegrations: {},
  setAgentIntegrations: (agentIntegrations) => set({ agentIntegrations }),

  agentProfiles: [],
  setAgentProfiles: (agentProfiles) => set({ agentProfiles }),

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
        message.recordId === undefined
          ? undefined
          : `${message.recordId}#${message.blockIndex ?? 0}`;
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
        apply.nextBefore !== undefined ? apply.nextBefore : isReset ? null : session.pagingCursor;

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
