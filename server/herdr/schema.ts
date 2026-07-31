import { z } from "zod";

// ---------------------------------------------------------------------------
// Response envelope
//
// herdr's wire protocol is NOT JSON-RPC 2.0: one newline-terminated JSON line
// per response, `{id, result}` on success, `{id, error}` on failure.
// Correlation is per-connection (one request per connection); protocol errors
// reply with an empty `id`.
// ---------------------------------------------------------------------------

export const RpcErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .passthrough();
export type RpcError = z.infer<typeof RpcErrorSchema>;

export const ErrorEnvelopeSchema = z
  .object({
    id: z.string(),
    error: RpcErrorSchema,
  })
  .passthrough();

export const ResultEnvelopeSchema = z
  .object({
    id: z.string(),
    result: z.record(z.unknown()),
  })
  .passthrough();

export const ResponseEnvelopeSchema = z.union([ErrorEnvelopeSchema, ResultEnvelopeSchema]);
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Result payloads (per-method, discriminated on `result.type`)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export const AgentStatusSchema = z.enum(["idle", "working", "blocked", "done", "unknown"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * One detected agent. Required core fields only; the live daemon omits
 * `agent_session` / `interactive_ready` (and may omit `state_change_seq`)
 * on partially detected agents. `revision` and `state_change_seq` are the
 * monotonic cursors for future gap detection.
 */
export const AgentInfoSchema = z
  .object({
    terminal_id: z.string(),
    agent_status: AgentStatusSchema,
    workspace_id: z.string(),
    tab_id: z.string(),
    pane_id: z.string(),
    focused: z.boolean(),
    revision: z.number(),
    state_change_seq: z.number().optional(),
    agent: z.string().optional(),
    agent_session: z.unknown().optional(),
    interactive_ready: z.boolean().optional(),
    cwd: z.string().optional(),
    foreground_cwd: z.string().optional(),
    terminal_title: z.string().optional(),
    terminal_title_stripped: z.string().optional(),
  })
  .passthrough();
export type AgentInfo = z.infer<typeof AgentInfoSchema>;

export const SessionSnapshotSchema = z
  .object({
    version: z.string(),
    protocol: z.number(),
    agents: z.array(AgentInfoSchema),
  })
  .passthrough();
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

export const PongResultSchema = z
  .object({
    type: z.literal("pong"),
    version: z.string(),
    protocol: z.number(),
    capabilities: z.record(z.boolean()),
  })
  .passthrough();
export type PongResult = z.infer<typeof PongResultSchema>;

export const SessionSnapshotResultSchema = z
  .object({
    type: z.literal("session_snapshot"),
    snapshot: SessionSnapshotSchema,
  })
  .passthrough();
export type SessionSnapshotResult = z.infer<typeof SessionSnapshotResultSchema>;

export const OkResultSchema = z
  .object({
    type: z.literal("ok"),
  })
  .passthrough();
export type OkResult = z.infer<typeof OkResultSchema>;

/** Union of every result payload this client understands. */
export const HerdrResultSchema = z.discriminatedUnion("type", [
  PongResultSchema,
  SessionSnapshotResultSchema,
  OkResultSchema,
]);
export type HerdrResult = z.infer<typeof HerdrResultSchema>;
