import { z } from "zod";
import { LAUNCHABLE_AGENT_KINDS } from "./agents/kinds";

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

/**
 * The user's answer to a permission prompt.
 *
 * `optionId` names one of the options the server offered — the terminal's own
 * choices, parsed off the screen (Decision H3). `allow` is the pre-#29 boolean
 * form, still accepted for one migration window so a cached PWA bundle can keep
 * answering prompts (Decision M14); the server maps `false` to `esc` and `true`
 * to the terminal's first option. Both are optional at the schema because a
 * discriminated union cannot carry a cross-field refinement; the handler
 * refuses a message carrying neither.
 */
const PermissionMessage = z.object({
  type: z.literal("permission"),
  requestId: z.string(),
  optionId: z.string().min(1).optional(),
  allow: z.boolean().optional(),
  answers: z.record(z.string()).optional(),
});

const InterruptMessage = z.object({
  type: z.literal("interrupt"),
  sessionId: z.string(),
});

const GetServerConfigMessage = z.object({
  type: z.literal("get_server_config"),
});

/**
 * `set_permission_mode`, `set_env_vars`, `set_model` and `set_effort` are gone.
 * They were accepted and echoed but reached nothing — herdr receives none of
 * it, and an agent's gating, model and effort are the agent's own settings,
 * which cc-mobile stopped deciding. Refused by the gate now, exactly like
 * #25's and #26's retired names: no compatibility window, a cached PWA bundle
 * recovers with a page reload.
 */
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
// `agentKind` is a closed enum, unlike the `agent` field on the session
// descriptor, which is herdr's own label and stays a free string. The direction
// is what differs: this value becomes the `kind` herdr executes, so a client
// must not be able to name an arbitrary one. Absent → claude (#31), which is
// what every bundle cached before #31 sends.
const TerminalCreateMessage = z.object({
  type: z.literal("terminal_create"),
  claudeUuid: z.string().min(1),
  cwd: z.string().min(1),
  agentKind: z.enum(LAUNCHABLE_AGENT_KINDS).optional(),
});

/**
 * Close a session. The key is the session id the server listed (herdr's pane
 * id, Decision H5); `claudeUuid` is the same field under its pre-#29 name and
 * stays accepted so a cached bundle can still close its own sessions. Exactly
 * one of the two is required.
 */
const TerminalTeardownMessage = z.object({
  type: z.literal("terminal_teardown"),
  sessionId: z.string().min(1).optional(),
  claudeUuid: z.string().min(1).optional(),
});

// Connection-scoped query: which terminal sessions is this server currently
// routing? A reconnecting client asks for it to find out which of its restored
// cards are still real. It is the only listing left — browsing claude's
// on-disk sessions was deleted in #26.
const ListTerminalSessionsMessage = z.object({
  type: z.literal("list_terminal_sessions"),
});

/**
 * Where a history page stops, and which transcript file that position is
 * measured in. The client sends back the cursor the server last gave it; the
 * server re-proves both halves against the file before honouring it, because
 * the path is resolved live and a terminal `/clear` rotates it underneath.
 */
const TranscriptPageCursorSchema = z.object({
  /** 16 hex chars naming the file the cursor was read from (`epochOf`). */
  epoch: z.string().min(1),
  /** Absolute byte offset of the record the page stops before. */
  seq: z.number(),
  /** That record's own id, so a shifted offset is detectable. */
  recordId: z.string().min(1),
});

/**
 * One page of a session's own backlog, older than `before` (absent → the newest
 * page). No page size on the wire: the server owns that number, so a client
 * cannot ask it to build an arbitrarily large frame.
 */
const TranscriptPageRequestMessage = z.object({
  type: z.literal("transcript_page_request"),
  sessionId: z.string().min(1),
  before: TranscriptPageCursorSchema.optional(),
});

/**
 * Ask one live session for its command / agent list. Same shape as
 * `transcript_page_request`: a named session, plus an optional refresh that
 * bypasses a cached success. No session is refused here, before anything runs.
 */
const CapabilitiesRequestMessage = z.object({
  type: z.literal("capabilities_request"),
  sessionId: z.string().min(1),
  refresh: z.boolean().optional(),
});

export const ClientMessage = z.discriminatedUnion("type", [
  PermissionMessage,
  InterruptMessage,
  GetServerConfigMessage,
  ListDirectoriesMessage,
  ReconnectMessage,
  AppendUserMessageSchema,
  StopTaskMessage,
  TerminalSendMessage,
  TerminalCreateMessage,
  TerminalTeardownMessage,
  ListTerminalSessionsMessage,
  TranscriptPageRequestMessage,
  CapabilitiesRequestMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

// Server → Client messages
const StreamChunkMessage = z.object({
  type: z.literal("stream_chunk"),
  sessionId: z.string(),
  /**
   * `{type, message}` straight out of `transcriptRecordToChunk`, plus the three
   * keys that say which record this is and where it sits: `recordId` (the
   * record's own `uuid`/`id`, absent when it carries neither), `seq` (its
   * absolute byte offset — the only total order the transcript supports) and
   * `epoch` (16 hex chars naming the file, from `epochOf`). All three are
   * stamped by the server; the record body itself is never reshaped.
   */
  chunk: z.record(z.unknown()),
});

const StreamEndMessage = z.object({
  type: z.literal("stream_end"),
  sessionId: z.string(),
});

/** One choice the terminal is offering, in the terminal's own wording. */
const PermissionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /**
   * The key the server presses in the pane when this option is chosen — where
   * a single key chooses it. Absent on omp (#33), whose options are unnumbered
   * and reached by arrow keys, so the keys depend on where the terminal's own
   * cursor is when the answer arrives. The client never reads this field; it
   * answers with `optionId` and the server works out the keystrokes.
   */
  keystroke: z.string().optional(),
});

/**
 * A pending permission prompt.
 *
 * Since #29 `tool.parameters` carries parsed SCREEN text (`{text, description}`)
 * rather than the structured hook `input` JSON: while claude is blocked the
 * transcript holds nothing about the pending call, so the screen is the only
 * machine-readable source (research P4). `options` is what the terminal actually
 * offers — 2 or 3, wording varies — and is optional only because the legacy hook
 * relay, alive until the pipeline is deleted, has none to report.
 */
const PermissionRequestMessage = z.object({
  type: z.literal("permission_request"),
  sessionId: z.string(),
  requestId: z.string(),
  tool: z.object({
    name: z.string(),
    parameters: z.record(z.unknown()),
  }),
  options: z.array(PermissionOptionSchema).optional(),
});

const ErrorMessage = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  sessionId: z.string().optional(),
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
  argumentHint: z.string().optional(),
});

/**
 * Reply to `capabilities_request`, sent with a bare `ws.send`: it answers one
 * connection's question about one named session, so it is session-addressed
 * by construction and never a machine-wide snapshot.
 */
const CapabilitiesListMessage = z.object({
  type: z.literal("capabilities_list"),
  sessionId: z.string().min(1),
  commands: z.array(CommandInfoSchema),
  agents: z.array(AgentInfoSchema),
});

const AgentProfileSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(LAUNCHABLE_AGENT_KINDS),
});

const ServerConfigMessage = z.object({
  type: z.literal("server_config"),
  // Only what the server knows and the client cannot. The agent-setting fields
  // (permissionMode, model, effort) went with the messages that set them.
  config: z.object({
    allowedRoots: z.array(z.string()).nullable().optional(),
    homeDirectory: z.string().optional(),
    // Which kinds this machine can actually launch (#31). Sent only in the
    // reply to `get_server_config`; the four `set_*` echoes carry a partial
    // config and the client merges field by field, so it is not dropped there.
    availableAgents: z.array(z.enum(LAUNCHABLE_AGENT_KINDS)).optional(),
    agentProfiles: z.array(AgentProfileSummarySchema).optional(),
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

/**
 * One live agent pane, as the daemon reports it. `sessionId` is herdr's
 * `pane_id` (Decision H5): it exists for every pane, including ones with no
 * agent session uuid, and it survives a `/clear` that rotates
 * `agentSessionValue`.
 *
 * The three flags are what let a card render honestly instead of guessing:
 * `readable:false` means replies cannot be read back (no transcript key, or no
 * reader for that kind), `origin:"foreign"` means the user opened it in their
 * own terminal (so no close affordance — Decision M13), and `gated:false` means
 * the agent runs there with no permission gate. `gated` is a warning, never a
 * lock: such panes stay drivable by the owner's own ruling (Decision H4).
 */
const TerminalSessionDescriptor = z.object({
  sessionId: z.string(),
  /**
   * Which kind of agent herdr detected in that pane ("claude", "omp", …),
   * verbatim and never normalised — the daemon's vocabulary is its own and
   * grows between versions, so no enum may refuse a label this build has not
   * heard of.
   *
   * **Absent means herdr has not detected a kind yet — never "assume claude".**
   * A client that defaults it would label a pane wrongly and, worse, invite the
   * server to go looking for a claude transcript that does not exist.
   *
   * Snapshot-time value: it is whatever the daemon said when this listing was
   * built. Nothing in the tree pushes a kind on its own — no event, no
   * `session_state` field — so a pane whose detection completes later is
   * corrected the next time the client asks for the list (i.e. on reconnect).
   */
  agent: z.string().optional(),
  /**
   * The pane's own title, as herdr reports it (`terminal_title_stripped`) —
   * what claude called the work it is doing. Absent when herdr has no title
   * for that pane; a client must then say so rather than invent one.
   *
   * The *stripped* form on purpose: `terminal_title` carries a spinner glyph,
   * and activity is already `state`'s job. A glyph captured in a snapshot
   * freezes, so it would sit there claiming motion that stopped.
   *
   * Snapshot-time value, exactly like `agent`: nothing pushes a title on its
   * own, and it is corrected the next time the client asks for the listing. A
   * working claude retitles its pane every second (see commit 9269787), so
   * pushing this would put back the per-second chatter that commit removed.
   * Liveness is `session_state`'s job; this field is identity.
   */
  title: z.string().optional(),
  agentSessionValue: z.string().nullable(),
  cwd: z.string(),
  origin: z.enum(["self", "foreign"]),
  drivable: z.boolean(),
  readable: z.boolean(),
  /**
   * Why `readable` is false, sent only when it is. `readable` alone cannot tell
   * "nobody has spoken to this pane yet" (`"pending"` — an omp whose first turn
   * has not written its file) from "this build cannot read that kind back at
   * all" (`"unsupported"` — no key, or no registered reader), and a screen with
   * nothing on it has to say opposite things about the two: one invites a
   * message, the other explains a silence that typing will not end.
   *
   * Optional rather than a widened `readable`, so a bundle cached before this
   * field keeps reading the boolean it already knows. `"unsupported"` describes
   * now, not forever — an undetected kind lands there and leaves it on the
   * listing after herdr reports one.
   */
  unreadableReason: z.enum(["pending", "unsupported"]).optional(),
  gated: z.boolean(),
  state: z.enum(["idle", "running", "requires_action"]).optional(),
});

/** Reply to list_terminal_sessions. Empty list means "none live", not "unknown". */
const TerminalSessionsMessage = z.object({
  type: z.literal("terminal_sessions"),
  /**
   * Every agent pane on the machine, foreign ones included (Decision H1) and
   * whatever kind is running in them (#30).
   */
  sessions: z.array(TerminalSessionDescriptor),
  /**
   * The same sessions as bare ids, in the same order — `sessions.map(s =>
   * s.sessionId)`. Kept so a client that only reconciles ids keeps working;
   * `unknownUuids` is gone with the remount scan that produced it (M12).
   *
   * The name is outdated and kept anyway: these are pane ids of every kind of
   * agent since #30, not claude uuids. Renaming it would break every cached
   * PWA bundle for a field that is already only a mirror.
   */
  claudeUuids: z.array(z.string()),
  /**
   * What each live session is doing right now, so the first paint after a
   * reload is correct instead of waiting for the next status change. Optional
   * rather than required: unlike the two arrays, a missing map cannot be
   * misread — it means "no snapshot", which the client already handles. A uuid
   * absent from the map is "no claim", never "idle".
   */
  states: z.record(z.enum(["idle", "running", "requires_action"])).optional(),
});

/**
 * The reply to `transcript_page_request`, sent with a bare `ws.send`: it answers
 * one connection's question, so it is never wrapped in an `event` envelope and
 * never replayed on reconnect.
 *
 * `epoch` is not nullable and never a placeholder — it names the file the page
 * was actually read from, which may not be the one the request's cursor named.
 * A session with no resolvable transcript gets `transcript_unavailable` instead.
 * Each element of `records` has the same shape as `stream_chunk.chunk`.
 */
const TranscriptPageMessage = z.object({
  type: z.literal("transcript_page"),
  sessionId: z.string(),
  epoch: z.string().min(1),
  records: z.array(z.record(z.unknown())),
  nextBefore: TranscriptPageCursorSchema.nullable(),
});

export const ServerMessage = z.discriminatedUnion("type", [
  StreamChunkMessage,
  StreamEndMessage,
  PermissionRequestMessage,
  ErrorMessage,
  CapabilitiesListMessage,
  ServerConfigMessage,
  DirectoryListingMessage,
  EventWrapperMessage,
  ReplayCompleteMessage,
  SessionStateMessage,
  TerminalSessionsMessage,
  TranscriptPageMessage,
]);

export type ServerMessage = z.infer<typeof ServerMessage>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type CommandInfo = z.infer<typeof CommandInfoSchema>;
