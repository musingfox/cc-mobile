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
 * Inbound reading of the same enum. Deliberately `z.string()`, not the enum: a
 * status this build has never heard of must pass the parse and then fail the
 * lookup (STATE_BY_AGENT_STATUS in agent-state.ts has no entry for it, which
 * reads as "no claim"). `session.snapshot` is what the startup remount parses,
 * and a failed remount is fatal (index.ts exits 1) — a daemon-side enum addition
 * must not be able to brick boot. Presence is still required wherever the daemon
 * promises the field: an *absent* status is a shape violation, not new vocabulary.
 */
const ReportedAgentStatusSchema = z.string();

/**
 * The agent's own session identity. For claude this is always `kind: "id"`:
 * herdr's SessionStart hook does report an `agent_session_path`, but the daemon
 * discards it for every agent except pi/omp, so `value` (the claude session
 * uuid) is the only key a transcript path can be derived from.
 *
 * Live wire fact (probe 2026-08-02): the value rotates on `/clear` and survives
 * `claude -c`, so it is a *transcript* key, never a session identity — panes are
 * keyed by `pane_id` (Decision H5). `value` is optional so a partially reported
 * session cannot fail the whole agent parse.
 */
export const AgentSessionSchema = z
  .object({
    value: z.string().optional(),
    agent: z.string().optional(),
    kind: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough();
export type AgentSession = z.infer<typeof AgentSessionSchema>;

/**
 * One detected agent. Required core fields only; the live daemon omits
 * `agent_session` / `interactive_ready` (and may omit `state_change_seq`)
 * on partially detected agents. `revision` and `state_change_seq` are the
 * monotonic cursors for future gap detection.
 */
export const AgentInfoSchema = z
  .object({
    terminal_id: z.string(),
    agent_status: ReportedAgentStatusSchema,
    workspace_id: z.string(),
    tab_id: z.string(),
    pane_id: z.string(),
    focused: z.boolean(),
    revision: z.number(),
    state_change_seq: z.number().optional(),
    agent: z.string().optional(),
    agent_session: AgentSessionSchema.nullish(),
    interactive_ready: z.boolean().optional(),
    cwd: z.string().optional(),
    foreground_cwd: z.string().optional(),
    terminal_title: z.string().optional(),
    terminal_title_stripped: z.string().optional(),
  })
  .passthrough();
export type AgentInfo = z.infer<typeof AgentInfoSchema>;

/**
 * One workspace. `label` is the field cc-mobile writes its uuid into, which
 * makes this the persistence record a restart reads its sessions back from —
 * so it is typed rather than left to passthrough. Required per the daemon's
 * own schema (probe 2026-08-01); the rest of its fields ride passthrough.
 */
export const WorkspaceInfoSchema = z
  .object({
    workspace_id: z.string(),
    label: z.string(),
  })
  .passthrough();
export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>;

/**
 * One pane. `agent` is the daemon's own detection ("claude" while a claude is
 * running) and is optional — it is absent on panes sitting at a shell prompt.
 * `agent_status` rides passthrough today; typing it optional only names data
 * that already arrives, and keeps a pane without a detected agent parseable.
 * An unrecognised value reads as `unknown` rather than failing the parse — see
 * ReportedAgentStatusSchema: this snapshot feeds the boot-time remount.
 */
export const PaneInfoSchema = z
  .object({
    pane_id: z.string(),
    workspace_id: z.string(),
    agent: z.string().nullish(),
    agent_status: ReportedAgentStatusSchema.optional(),
    // Live wire fact (probe 2026-08-02): `pane.updated` carries the full pane
    // record including its agent session, which is how a `/clear` that rotates
    // the transcript key is noticed without polling.
    agent_session: AgentSessionSchema.nullish(),
  })
  .passthrough();
export type PaneInfo = z.infer<typeof PaneInfoSchema>;

export const SessionSnapshotSchema = z
  .object({
    version: z.string(),
    protocol: z.number(),
    // Required by the daemon and required here: a restart that silently saw an
    // empty workspace list would adopt nothing and report no error at all.
    workspaces: z.array(WorkspaceInfoSchema),
    panes: z.array(PaneInfoSchema),
    agents: z.array(AgentInfoSchema),
  })
  .passthrough();
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

/**
 * One foreground process in a pane, as `pane.process_info` reports it. `argv`
 * and `argv0` are both nullable on the wire — the daemon cannot always read a
 * process's command line — so every consumer must tolerate null.
 */
export const PaneProcessSchema = z
  .object({
    argv: z.array(z.string()).nullish(),
    argv0: z.string().nullish(),
  })
  .passthrough();
export type PaneProcess = z.infer<typeof PaneProcessSchema>;

export const PaneProcessInfoSchema = z
  .object({
    pane_id: z.string(),
    foreground_processes: z.array(PaneProcessSchema).nullish(),
  })
  .passthrough();
export type PaneProcessInfo = z.infer<typeof PaneProcessInfoSchema>;

/** Live wire fact (probe 2026-08-01): the payload nests under `process_info`. */
export const PaneProcessInfoResultSchema = z
  .object({
    type: z.literal("pane_process_info"),
    process_info: PaneProcessInfoSchema,
  })
  .passthrough();
export type PaneProcessInfoResult = z.infer<typeof PaneProcessInfoResultSchema>;

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

export const ReadSourceSchema = z.enum(["visible", "recent", "recent_unwrapped", "detection"]);
export type ReadSource = z.infer<typeof ReadSourceSchema>;

/**
 * pane.read payload. Caveat: `source: "recent"` / `"recent_unwrapped"` return
 * empty text on freshly created panes — use `"visible"` for screen content.
 */
export const PaneReadSchema = z
  .object({
    pane_id: z.string(),
    source: z.string(),
    text: z.string(),
    revision: z.number(),
    truncated: z.boolean(),
    workspace_id: z.string().optional(),
    tab_id: z.string().optional(),
    format: z.string().optional(),
  })
  .passthrough();
export type PaneRead = z.infer<typeof PaneReadSchema>;

export const PaneReadResultSchema = z
  .object({
    type: z.literal("pane_read"),
    read: PaneReadSchema,
  })
  .passthrough();
export type PaneReadResult = z.infer<typeof PaneReadResultSchema>;

export const AgentListResultSchema = z
  .object({
    type: z.literal("agent_list"),
    agents: z.array(AgentInfoSchema),
  })
  .passthrough();
export type AgentListResult = z.infer<typeof AgentListResultSchema>;

export const AgentInfoResultSchema = z
  .object({
    type: z.literal("agent_info"),
    agent: AgentInfoSchema,
  })
  .passthrough();
export type AgentInfoResult = z.infer<typeof AgentInfoResultSchema>;

export const OkResultSchema = z
  .object({
    type: z.literal("ok"),
  })
  .passthrough();
export type OkResult = z.infer<typeof OkResultSchema>;

/** Ack line confirming an events.subscribe stream is live. */
export const SubscriptionStartedResultSchema = z
  .object({
    type: z.literal("subscription_started"),
  })
  .passthrough();
export type SubscriptionStartedResult = z.infer<typeof SubscriptionStartedResultSchema>;

/**
 * One streamed event line: `{event, data}` — no id, no sequence number
 * (the wire carries no cursor; per-kind `data` typing lands with consumers).
 */
export const EventEnvelopeSchema = z
  .object({
    event: z.string(),
    data: z.unknown(),
  })
  .passthrough();
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/** Union of every result payload this client understands. */
export const HerdrResultSchema = z.discriminatedUnion("type", [
  PongResultSchema,
  SessionSnapshotResultSchema,
  PaneReadResultSchema,
  AgentListResultSchema,
  AgentInfoResultSchema,
  OkResultSchema,
  SubscriptionStartedResultSchema,
]);
export type HerdrResult = z.infer<typeof HerdrResultSchema>;
