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

const InterruptMessage = z.object({
  type: z.literal("interrupt"),
  sessionId: z.string(),
});

export const ClientMessage = z.discriminatedUnion("type", [
  NewSessionMessage,
  SendMessage,
  PermissionMessage,
  InterruptMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

// Server → Client messages
const SessionCreatedMessage = z.object({
  type: z.literal("session_created"),
  sessionId: z.string(),
});

const StreamChunkMessage = z.object({
  type: z.literal("stream_chunk"),
  sessionId: z.string(),
  chunk: z.object({
    text: z.string(),
  }).passthrough(),
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

export const ServerMessage = z.discriminatedUnion("type", [
  SessionCreatedMessage,
  StreamChunkMessage,
  StreamEndMessage,
  PermissionRequestMessage,
  ResultMessage,
  ErrorMessage,
]);

export type ServerMessage = z.infer<typeof ServerMessage>;
