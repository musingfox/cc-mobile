import { z } from "zod";

// Content blocks for multimodal input
const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ImageBlockSchema = z.object({
  type: z.literal("image"),
  source: z.object({
    type: z.literal("base64"),
    media_type: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
    data: z.string(),
  }),
});

const ContentBlockSchema = z.discriminatedUnion("type", [TextBlockSchema, ImageBlockSchema]);

export type TextBlock = z.infer<typeof TextBlockSchema>;
export type ImageBlock = z.infer<typeof ImageBlockSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// Client → Server messages
const SetSessionTitleMessage = z.object({
  type: z.literal("set_session_title"),
  sdkSessionId: z.string(),
  title: z.string(),
  dir: z.string().optional(),
});

const AppendUserMessageSchema = z.object({
  type: z.literal("append_user_message"),
  sessionId: z.string(),
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
});

const StopTaskMessage = z.object({
  type: z.literal("stop_task"),
  sessionId: z.string(),
  taskId: z.string(),
});

const PermissionMessage = z.object({
  type: z.literal("permission"),
  requestId: z.string(),
  allow: z.boolean(),
  answers: z.record(z.string()).optional(),
});

const InterruptMessage = z.object({
  type: z.literal("interrupt"),
  sessionId: z.string(),
});

const GetServerConfigMessage = z.object({
  type: z.literal("get_server_config"),
});

const ListSessionsMessage = z.object({
  type: z.literal("list_sessions"),
  dir: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

const ResumeSessionMessage = z.object({
  type: z.literal("resume_session"),
  sdkSessionId: z.string(),
  cwd: z.string(),
});

const SetPermissionModeMessage = z.object({
  type: z.literal("set_permission_mode"),
  mode: z.enum(["default", "acceptEdits", "auto", "bypassPermissions", "dontAsk", "plan"]),
  sessionId: z.string().optional(),
});

const SetEnvVarsMessage = z.object({
  type: z.literal("set_env_vars"),
  envVars: z.record(z.string()),
});

const SetModelMessage = z.object({
  type: z.literal("set_model"),
  model: z.string(),
  sessionId: z.string().optional(),
});

const SetEffortMessage = z.object({
  type: z.literal("set_effort"),
  effort: z.enum(["low", "medium", "high", "max"]).nullable(),
});

const ListDirectoriesMessage = z.object({
  type: z.literal("list_directories"),
  path: z.string(),
});

const ReconnectMessage = z.object({
  type: z.literal("reconnect"),
  // Legacy single global cursor — kept for backward compatibility. eventIds are
  // per-session (start at 1), so a single global cursor breaks replay across
  // sessions; prefer lastEventIds below.
  lastEventId: z.number().nullable(),
  // Per-session replay baseline: { [sessionId]: lastSeenEventId }. The server
  // replays events with eventId > baseline for each session independently.
  lastEventIds: z.record(z.string(), z.number()).optional(),
  sessionIds: z.array(z.string()),
});

const TmuxSendMessage = z.object({
  type: z.literal("tmux_send"),
  claudeUuid: z.string(),
  content: z.string(),
});

// claudeUuid stays a loose string (matching TmuxSendMessage) rather than .uuid().
// .min(1) preserves the empty-string rejection the hand-rolled ws.ts parser did
// before these two joined the union.
const TmuxCreateMessage = z.object({
  type: z.literal("tmux_create"),
  claudeUuid: z.string().min(1),
  cwd: z.string().min(1),
});

const TmuxTeardownMessage = z.object({
  type: z.literal("tmux_teardown"),
  claudeUuid: z.string().min(1),
});

// Connection-scoped query, deliberately separate from list_sessions: that one
// lists claude's on-disk SDK sessions, this one lists the terminal sessions
// this server is currently routing. A reconnecting client asks for it to find
// out which of its restored cards are still real.
const ListTerminalSessionsMessage = z.object({
  type: z.literal("list_terminal_sessions"),
});

export const ClientMessage = z.discriminatedUnion("type", [
  PermissionMessage,
  InterruptMessage,
  GetServerConfigMessage,
  ListSessionsMessage,
  ResumeSessionMessage,
  SetPermissionModeMessage,
  SetEnvVarsMessage,
  SetModelMessage,
  SetEffortMessage,
  ListDirectoriesMessage,
  ReconnectMessage,
  SetSessionTitleMessage,
  AppendUserMessageSchema,
  StopTaskMessage,
  TmuxSendMessage,
  TmuxCreateMessage,
  TmuxTeardownMessage,
  ListTerminalSessionsMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

// Server → Client messages
const SessionCreatedMessage = z.object({
  type: z.literal("session_created"),
  sessionId: z.string(),
  cwd: z.string(),
});

const StreamChunkMessage = z.object({
  type: z.literal("stream_chunk"),
  sessionId: z.string(),
  chunk: z.record(z.unknown()),
});

const StreamEndMessage = z.object({
  type: z.literal("stream_end"),
  sessionId: z.string(),
});

const PermissionRequestMessage = z.object({
  type: z.literal("permission_request"),
  sessionId: z.string(),
  requestId: z.string(),
  tool: z.object({
    name: z.string(),
    parameters: z.record(z.unknown()),
  }),
});

const ErrorMessage = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  sessionId: z.string().optional(),
});

const ModelInfoSchema = z.object({
  value: z.string(),
  displayName: z.string(),
  description: z.string(),
  supportsEffort: z.boolean().optional(),
  supportedEffortLevels: z.array(z.string()).optional(),
  supportsFastMode: z.boolean().optional(),
  supportsAdaptiveThinking: z.boolean().optional(),
});

const AccountInfoSchema = z.object({
  email: z.string().optional(),
  organization: z.string().optional(),
  subscriptionType: z.string().optional(),
  tokenSource: z.string().optional(),
  apiKeySource: z.string().optional(),
});

const AgentInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  icon: z.string().optional(),
});

const CommandInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
});

const CapabilitiesMessage = z.object({
  type: z.literal("capabilities"),
  sessionId: z.string(),
  commands: z.union([z.array(z.string()), z.array(CommandInfoSchema)]).transform((val) => {
    if (val.length === 0) return [];
    return typeof val[0] === "string" ? val.map((name) => ({ name })) : val;
  }),
  agents: z.union([z.array(z.string()), z.array(AgentInfoSchema)]).transform((val) => {
    if (val.length === 0) return [];
    return typeof val[0] === "string" ? val.map((name) => ({ name })) : val;
  }),
  model: z.string(),
  models: z.array(ModelInfoSchema).optional(),
  accountInfo: AccountInfoSchema.optional(),
});

const ServerConfigMessage = z.object({
  type: z.literal("server_config"),
  config: z.object({
    permissionMode: z
      .enum(["default", "acceptEdits", "auto", "bypassPermissions", "dontAsk", "plan"])
      .optional(),
    sessionId: z.string().optional(),
    allowedRoots: z.array(z.string()).nullable().optional(),
    homeDirectory: z.string().optional(),
  }),
});

export const SessionListItemSchema = z.object({
  sdkSessionId: z.string(),
  displayTitle: z.string(),
  cwd: z.string(),
  gitBranch: z.string().optional(),
  lastModified: z.number(),
  createdAt: z.number().optional(),
  customTitle: z.string().optional(),
});

export const HistoryMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.number(),
});

const SessionListMessage = z.object({
  type: z.literal("session_list"),
  sessions: z.array(SessionListItemSchema),
});

const SessionHistoryMessage = z.object({
  type: z.literal("session_history"),
  sessionId: z.string(),
  messages: z.array(HistoryMessageSchema),
});

const DirectoryListingMessage = z.object({
  type: z.literal("directory_listing"),
  path: z.string(),
  entries: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
    }),
  ),
  parent: z.string().nullable(),
});

const EventWrapperMessage = z.object({
  type: z.literal("event"),
  eventId: z.number(),
  sessionId: z.string(),
  payload: z.record(z.unknown()), // raw ServerMessage, validated separately
});

const ReplayCompleteMessage = z.object({
  type: z.literal("replay_complete"),
  sessionId: z.string(),
  eventsReplayed: z.number(),
  gapDetected: z.boolean(),
});

const SessionStateMessage = z.object({
  type: z.literal("session_state"),
  sessionId: z.string(),
  state: z.enum(["idle", "running", "requires_action"]),
});

/** Reply to list_terminal_sessions. Empty list means "none live", not "unknown". */
const TerminalSessionsMessage = z.object({
  type: z.literal("terminal_sessions"),
  claudeUuids: z.array(z.string()),
  /**
   * Sessions the startup remount skipped (transient RPC failure, ambiguous
   * pane): possibly alive but not routable. Clients must leave their cards
   * alone — neither ready nor removed.
   */
  unknownUuids: z.array(z.string()),
});

export const ServerMessage = z.discriminatedUnion("type", [
  SessionCreatedMessage,
  StreamChunkMessage,
  StreamEndMessage,
  PermissionRequestMessage,
  ErrorMessage,
  CapabilitiesMessage,
  ServerConfigMessage,
  SessionListMessage,
  SessionHistoryMessage,
  DirectoryListingMessage,
  EventWrapperMessage,
  ReplayCompleteMessage,
  SessionStateMessage,
  TerminalSessionsMessage,
]);

export type ServerMessage = z.infer<typeof ServerMessage>;
export type SessionListItem = z.infer<typeof SessionListItemSchema>;
export type HistoryMessage = z.infer<typeof HistoryMessageSchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type CommandInfo = z.infer<typeof CommandInfoSchema>;
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type AccountInfo = z.infer<typeof AccountInfoSchema>;
