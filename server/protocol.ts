import { z } from "zod";

// Client → Server messages
const NewSessionMessage = z.object({
  type: z.literal("new_session"),
  cwd: z.string(),
});

const SendMessage = z.object({
  type: z.literal("send"),
  sessionId: z.string(),
  content: z.string(),
});

const PermissionMessage = z.object({
  type: z.literal("permission"),
  requestId: z.string(),
  allow: z.boolean(),
});

const CommandMessage = z.object({
  type: z.literal("command"),
  sessionId: z.string(),
  command: z.string(),
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

export const ClientMessage = z.discriminatedUnion("type", [
  NewSessionMessage,
  SendMessage,
  PermissionMessage,
  CommandMessage,
  InterruptMessage,
  GetServerConfigMessage,
  ListSessionsMessage,
  ResumeSessionMessage,
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

const ResultMessage = z.object({
  type: z.literal("result"),
  sessionId: z.string(),
  success: z.boolean(),
  cost: z.number().optional(),
});

const ErrorMessage = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  sessionId: z.string().optional(),
});

const CapabilitiesMessage = z.object({
  type: z.literal("capabilities"),
  sessionId: z.string(),
  commands: z.array(z.string()),
  agents: z.array(z.string()),
  model: z.string(),
});

const ServerConfigMessage = z.object({
  type: z.literal("server_config"),
  config: z.object({
    permissionMode: z.enum(["default", "acceptEdits", "bypassPermissions"]),
  }),
});

export const SessionListItemSchema = z.object({
  sdkSessionId: z.string(),
  displayTitle: z.string(),
  cwd: z.string(),
  gitBranch: z.string().optional(),
  lastModified: z.number(),
  createdAt: z.number().optional(),
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

export const ServerMessage = z.discriminatedUnion("type", [
  SessionCreatedMessage,
  StreamChunkMessage,
  StreamEndMessage,
  PermissionRequestMessage,
  ResultMessage,
  ErrorMessage,
  CapabilitiesMessage,
  ServerConfigMessage,
  SessionListMessage,
  SessionHistoryMessage,
]);

export type ServerMessage = z.infer<typeof ServerMessage>;
export type SessionListItem = z.infer<typeof SessionListItemSchema>;
export type HistoryMessage = z.infer<typeof HistoryMessageSchema>;
