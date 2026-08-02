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

const TerminalSendMessage = z.object({
  type: z.literal("terminal_send"),
  claudeUuid: z.string(),
  content: z.string(),
});

// claudeUuid stays a loose string (matching TerminalSendMessage) rather than .uuid().
// .min(1) preserves the empty-string rejection the hand-rolled ws.ts parser did
// before these two joined the union.
const TerminalCreateMessage = z.object({
  type: z.literal("terminal_create"),
  claudeUuid: z.string().min(1),
  cwd: z.string().min(1),
});

const TerminalTeardownMessage = z.object({
  type: z.literal("terminal_teardown"),
  claudeUuid: z.string().min(1),
});

// Connection-scoped query: which terminal sessions is this server currently
// routing? A reconnecting client asks for it to find out which of its restored
// cards are still real. It is the only listing left — browsing claude's
// on-disk sessions was deleted in #26.
const ListTerminalSessionsMessage = z.object({
  type: z.literal("list_terminal_sessions"),
});

export const ClientMessage = z.discriminatedUnion("type", [
  PermissionMessage,
  InterruptMessage,
  GetServerConfigMessage,
  SetPermissionModeMessage,
  SetEnvVarsMessage,
  SetModelMessage,
  SetEffortMessage,
  ListDirectoriesMessage,
  ReconnectMessage,
  AppendUserMessageSchema,
  StopTaskMessage,
  TerminalSendMessage,
  TerminalCreateMessage,
  TerminalTeardownMessage,
  ListTerminalSessionsMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

// Server → Client messages
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
  /**
   * What each live session is doing right now, so the first paint after a
   * reload is correct instead of waiting for the next status change. Optional
   * rather than required: unlike the two arrays, a missing map cannot be
   * misread — it means "no snapshot", which the client already handles. A uuid
   * absent from the map is "no claim", never "idle".
   */
  states: z.record(z.enum(["idle", "running", "requires_action"])).optional(),
});

export const ServerMessage = z.discriminatedUnion("type", [
  StreamChunkMessage,
  StreamEndMessage,
  PermissionRequestMessage,
  ErrorMessage,
  CapabilitiesMessage,
  ServerConfigMessage,
  DirectoryListingMessage,
  EventWrapperMessage,
  ReplayCompleteMessage,
  SessionStateMessage,
  TerminalSessionsMessage,
]);

export type ServerMessage = z.infer<typeof ServerMessage>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type CommandInfo = z.infer<typeof CommandInfoSchema>;
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type AccountInfo = z.infer<typeof AccountInfoSchema>;
