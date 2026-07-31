import type { ZodType } from "zod";
import { HerdrProtocolError } from "./errors";
import {
  type AgentInfo,
  AgentInfoResultSchema,
  AgentListResultSchema,
  type AgentStatus,
  OkResultSchema,
  type PaneRead,
  PaneReadResultSchema,
  type PongResult,
  PongResultSchema,
  type ReadSource,
  type SessionSnapshot,
  SessionSnapshotResultSchema,
} from "./schema";
import {
  createHerdrTransport,
  createUnixConnect,
  type HerdrConnect,
  type HerdrRequestOptions,
  type HerdrTransport,
  resolveSocketPath,
} from "./transport";

/** The single herdr wire protocol version this client understands (see ADR-015 / issue #20). */
export const SUPPORTED_PROTOCOL = 17;

/** Default daemon-side wait budget when the caller passes no timeout_ms. */
const DEFAULT_AGENT_WAIT_TIMEOUT_MS = 60_000;
/** Client read-deadline margin so the daemon's own timeout always fires first. */
const AGENT_WAIT_DEADLINE_MARGIN_MS = 5_000;

export interface HerdrClientOptions {
  /** Explicit socket path; falls back to $HERDR_SOCKET_PATH, then ~/.config/herdr/herdr.sock. */
  socketPath?: string;
  /** DI seam: injectable connection factory (used by transport and subscriptions). */
  connect?: HerdrConnect;
  /** DI seam: injectable transport (unit tests). */
  transport?: HerdrTransport;
}

export function createHerdrClient(options: HerdrClientOptions = {}) {
  const socketPath = resolveSocketPath(options.socketPath);
  const connect = options.connect ?? createUnixConnect(socketPath);
  const transport = options.transport ?? createHerdrTransport({ connect });

  /**
   * Raw escape hatch: issue any herdr RPC; when `schema` is given the result
   * payload is validated and typed, otherwise returned as `unknown`.
   */
  async function call<T = unknown>(
    method: string,
    params: unknown,
    schema?: ZodType<T>,
    requestOptions?: HerdrRequestOptions,
  ): Promise<T> {
    const result = await transport.request(method, params, requestOptions);
    return schema ? schema.parse(result) : (result as T);
  }

  /**
   * Pings the daemon and fails loudly when it speaks a protocol other than
   * SUPPORTED_PROTOCOL — one clear error instead of downstream schema garbage.
   */
  async function assertCompatible(): Promise<PongResult> {
    const pong = await call("ping", {}, PongResultSchema);
    if (pong.protocol !== SUPPORTED_PROTOCOL) {
      throw new HerdrProtocolError(
        `herdr daemon (version ${pong.version}) speaks protocol ${pong.protocol}; ` +
          `this client requires protocol ${SUPPORTED_PROTOCOL}`,
      );
    }
    return pong;
  }

  /**
   * Fetches the full daemon session state as one validated snapshot.
   * Agent entries expose the monotonic cursors `revision` / `state_change_seq`.
   */
  async function sessionSnapshot(): Promise<SessionSnapshot> {
    const result = await call("session.snapshot", {}, SessionSnapshotResultSchema);
    return result.snapshot;
  }

  /**
   * Types `text` into the target pane exactly as given. Never submits:
   * the daemon's pane.send_text does not press Enter (use paneSendKeys).
   */
  async function paneSendText(pane_id: string, text: string): Promise<void> {
    await call("pane.send_text", { pane_id, text }, OkResultSchema);
  }

  /** Lists all detected agents across the daemon. */
  async function agentList(): Promise<AgentInfo[]> {
    const result = await call("agent.list", {}, AgentListResultSchema);
    return result.agents;
  }

  /**
   * Fetches one pane's agent info by target (accepts a pane id).
   * Panes without a detected agent reject with code "agent_not_found".
   */
  async function agentGet(target: string): Promise<AgentInfo> {
    const result = await call("agent.get", { target }, AgentInfoResultSchema);
    return result.agent;
  }

  /**
   * Blocks until the agent reaches one of the requested statuses. The daemon
   * holds the connection open and responds on resolve or its own timeout
   * (typed HerdrRpcError code "timeout"); the client read deadline sits
   * AGENT_WAIT_DEADLINE_MARGIN_MS past the daemon budget so a legitimate
   * long hold is never killed client-side.
   */
  async function agentWait(params: {
    target: string;
    until?: AgentStatus[];
    timeout_ms?: number;
  }): Promise<AgentInfo> {
    const daemonBudgetMs = params.timeout_ms ?? DEFAULT_AGENT_WAIT_TIMEOUT_MS;
    const result = await call("agent.wait", params, AgentInfoResultSchema, {
      timeoutMs: daemonBudgetMs + AGENT_WAIT_DEADLINE_MARGIN_MS,
    });
    return result.agent;
  }

  /**
   * Reads pane content. `source` is required and forwarded verbatim —
   * beware: `"recent"` / `"recent_unwrapped"` are empty on fresh panes;
   * use `"visible"` for what is on screen. Returns text plus the pane's
   * monotonic `revision`.
   */
  async function paneRead(params: {
    pane_id: string;
    source: ReadSource;
    lines?: number;
    format?: string;
    strip_ansi?: boolean;
  }): Promise<PaneRead> {
    const result = await call("pane.read", params, PaneReadResultSchema);
    return result.read;
  }

  /** Presses named keys (tmux-style, e.g. "Enter") in the target pane. */
  async function paneSendKeys(pane_id: string, keys: string[]): Promise<void> {
    await call("pane.send_keys", { pane_id, keys }, OkResultSchema);
  }

  return {
    assertCompatible,
    call,
    sessionSnapshot,
    agentList,
    agentGet,
    agentWait,
    paneRead,
    paneSendText,
    paneSendKeys,
  };
}

export type HerdrClient = ReturnType<typeof createHerdrClient>;
