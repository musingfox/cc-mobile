/**
 * terminal-backend.ts — TerminalBackend port + tmux adapter.
 *
 * The port is the neutral seam between the WS transport layer and whatever drives a
 * persistent terminal session. Today the only implementation is the tmux adapter
 * (createTmuxBackend), a thin wrapper over tmux-registry (session lifecycle) and
 * tmux-send-routing (prompt injection + reply sink routing) with no behavior change.
 *
 * Capability surface is deliberately limited to what tmux actually provides (ADR-015 /
 * plan D2): there is no subscribe/read — replies arrive out-of-band via the Stop hook
 * POSTing to pty-response, which tmux-send-routing turns into sink calls.
 *
 * herdr counterpart (issue #22, additive — this interface does not change):
 *   createSession ← sessionSnapshot (obtain a routable session, not necessarily spawn)
 *   send          ← paneSendText
 *   listLive      ← sessionSnapshot listing
 */

import {
  type CreateSessionInput,
  createTmuxRegistry,
  type HasSessionResult,
  type RunResult,
  type TeardownResult,
} from "./tmux-registry";
import {
  createTmuxSendRouting,
  type TmuxSendParams,
  type TmuxSendRoutingOptions,
} from "./tmux-send-routing";

// ── Port ─────────────────────────────────────────────────────────────────────

export type ClientSink = (msg: Record<string, unknown>) => void;

export interface TerminalSessionInfo {
  /** Backend-native session name (tmux: `ccm-<claudeUuid>`, herdr: the agent name). */
  name: string;
  /**
   * Backend-native pane handle, kept as an opaque string so both backends fit:
   * tmux stringifies its numeric pane pid, herdr passes its `pane_id` through.
   */
  paneRef: string;
  settingsPath: string;
}

export interface TerminalHasSessionResult {
  present: boolean;
  /** Omitted entirely when no session is present. */
  paneRef?: string;
}

export interface TerminalBackend {
  /**
   * Obtain a routable terminal session for claudeUuid. Rejects with the backend's
   * original Error (duplicate uuid, spawn failure) — callers translate to `tmux_error`.
   */
  createSession(input: CreateSessionInput): Promise<TerminalSessionInfo>;
  hasSession(claudeUuid: string): TerminalHasSessionResult;
  /** claudeUuids with a live session. */
  listLive(): string[];
  /** Terminal removal: kills the session AND cancels its pending reply waiter. Idempotent. */
  teardown(claudeUuid: string): Promise<TeardownResult>;
  teardownAll(): Promise<void>;
  /** Never throws: unregistered sink is a silent no-op, send failures are reported via the sink. */
  send(params: TmuxSendParams): Promise<void>;
  registerClient(claudeUuid: string, sink: ClientSink, owner?: unknown): void;
  getClient(claudeUuid: string): ClientSink | undefined;
  /** Transient disconnect cleanup — drops the owner's sinks but keeps waiters armed. */
  cleanupByOwner(owner: unknown): void;
}

// ── Collaborator shapes (structural — real factories satisfy these) ──────────

export interface TmuxRegistryLike {
  createSession(input: CreateSessionInput): Promise<{
    tmuxName: string;
    panePid: number;
    settingsPath: string;
  }>;
  hasSession(claudeUuid: string): HasSessionResult;
  listSessions(): string[];
  teardown(claudeUuid: string): Promise<TeardownResult>;
  teardownAll(): Promise<void>;
}

export interface TmuxSendRoutingLike {
  send(params: TmuxSendParams): Promise<void>;
  registerClient(claudeUuid: string, sink: ClientSink, owner?: unknown): void;
  getClient(claudeUuid: string): ClientSink | undefined;
  teardown(claudeUuid: string): void;
  cleanupByOwner(owner: unknown): void;
}

export interface TmuxBackendOptions {
  /** Injectable runner for tmux invocations — shared by registry and send routing. */
  runCommand?: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) => Promise<RunResult>;
  claudeBin?: string;
  responseUrl?: string;
  permissionUrl?: string;
  responseRelay?: TmuxSendRoutingOptions["responseRelay"];
  /** Test seams. */
  createRegistry?: (options: {
    runCommand?: TmuxBackendOptions["runCommand"];
    claudeBin?: string;
    responseUrl?: string;
    permissionUrl?: string;
  }) => TmuxRegistryLike;
  createSendRouting?: (options: {
    runCommand?: TmuxBackendOptions["runCommand"];
    responseRelay?: TmuxBackendOptions["responseRelay"];
  }) => TmuxSendRoutingLike;
}

// ── tmux adapter ─────────────────────────────────────────────────────────────

export function createTmuxBackend(options: TmuxBackendOptions = {}): TerminalBackend {
  const makeRegistry = options.createRegistry ?? createTmuxRegistry;
  const makeSendRouting = options.createSendRouting ?? createTmuxSendRouting;

  const registry = makeRegistry({
    runCommand: options.runCommand,
    claudeBin: options.claudeBin,
    responseUrl: options.responseUrl,
    permissionUrl: options.permissionUrl,
  });
  const routing = makeSendRouting({
    runCommand: options.runCommand,
    responseRelay: options.responseRelay,
  });

  return {
    async createSession(input) {
      const info = await registry.createSession(input);
      return {
        name: info.tmuxName,
        paneRef: String(info.panePid),
        settingsPath: info.settingsPath,
      };
    },
    hasSession: (claudeUuid) => {
      const result = registry.hasSession(claudeUuid);
      // paneRef stays absent (not undefined-valued) when there is no session.
      return result.panePid === undefined
        ? { present: result.present }
        : { present: result.present, paneRef: String(result.panePid) };
    },
    listLive: () => registry.listSessions(),
    async teardown(claudeUuid) {
      // Order preserved from the pre-port ws.ts handler: kill first, then cancel the waiter.
      const result = await registry.teardown(claudeUuid);
      routing.teardown(claudeUuid);
      return result;
    },
    teardownAll: () => registry.teardownAll(),
    send: (params) => routing.send(params),
    registerClient: (claudeUuid, sink, owner) => routing.registerClient(claudeUuid, sink, owner),
    getClient: (claudeUuid) => routing.getClient(claudeUuid),
    cleanupByOwner: (owner) => routing.cleanupByOwner(owner),
  };
}
