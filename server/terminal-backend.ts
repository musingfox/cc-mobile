/**
 * terminal-backend.ts — the TerminalBackend port.
 *
 * The port is the neutral seam between the WS transport layer and whatever drives a
 * persistent terminal session. Since #25 the only implementation is the herdr adapter
 * (server/herdr/backend.ts); the adapter that used to live here is gone.
 *
 * Capability surface is deliberately limited (ADR-015): there is no subscribe/read —
 * replies arrive out-of-band via the Stop hook POSTing to pty-response, which the
 * backend's send routing turns into sink calls.
 */

import type { LaunchableAgentKind } from "./agents/kinds";
import type { Side } from "./herdr/sides";

// ── Port ─────────────────────────────────────────────────────────────────────

export type ClientSink = (msg: Record<string, unknown>) => void;

/** Everything a backend needs to obtain a routable terminal session. */
export interface CreateSessionInput {
  claudeUuid: string;
  cwd: string;
  /** Which agent to launch; absent means claude (#31). */
  agentKind?: LaunchableAgentKind;
  /** Operator-configured argv from a server-owned launch profile. */
  profileArgs?: string[];
  /** Which daemon holds the new pane; read only by the sided backend, which strips it. */
  side?: Side;
}

export interface TeardownResult {
  killed: boolean;
  /**
   * Why nothing was killed, when the answer is not simply "no such session".
   * `not_owned` means the pane belongs to a terminal the user opened themselves:
   * closing it would kill their conversation, so no RPC is issued at all
   * (Decision M13).
   */
  reason?: "not_owned";
}

export interface TerminalSendParams {
  claudeUuid: string;
  content: string;
  /**
   * Wait until the agent is seen starting the turn, and report
   * `prompt_not_started` when it never does. Only `/api/launch` asks: nobody is
   * watching a launched pane to notice a prompt left sitting in its composer.
   */
  confirmStart?: boolean;
}

/**
 * How a send ended, returned to the caller as well as reported to the pane's
 * sink. A caller that must decide on it reads this, never the sink: a phone
 * listing sessions rebinds the sink mid-send, and other notices share it.
 */
export type TerminalSendOutcome =
  | { ok: true }
  | { ok: false; code: "session_busy" | "terminal_send_failed" | "prompt_not_started" };

export interface TerminalSessionInfo {
  /** Backend-native session name (herdr: the agent name). */
  name: string;
  /**
   * Backend-native pane handle, kept as an opaque string so any backend fits:
   * herdr passes its `pane_id` through.
   */
  paneRef: string;
}

export interface TerminalHasSessionResult {
  present: boolean;
  /** Omitted entirely when no session is present. */
  paneRef?: string;
}

export interface TerminalBackend {
  /**
   * Obtain a routable terminal session for claudeUuid. Rejects with the backend's
   * original Error (duplicate uuid, spawn failure) — callers translate to `terminal_error`.
   */
  createSession(input: CreateSessionInput): Promise<TerminalSessionInfo>;
  hasSession(claudeUuid: string): TerminalHasSessionResult;
  /** claudeUuids with a live session. */
  listLive(): string[];
  /** Terminal removal: kills the session AND cancels its pending reply waiter. Idempotent. */
  teardown(claudeUuid: string): Promise<TeardownResult>;
  teardownAll(): Promise<void>;
  /** Never throws: unregistered sink is a silent no-op, send failures are reported via the sink. */
  send(params: TerminalSendParams): Promise<TerminalSendOutcome | void>;
  registerClient(claudeUuid: string, sink: ClientSink, owner?: unknown): void;
  getClient(claudeUuid: string): ClientSink | undefined;
  /** Transient disconnect cleanup — drops the owner's sinks but keeps waiters armed. */
  cleanupByOwner(owner: unknown): void;
}
