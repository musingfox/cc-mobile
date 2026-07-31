import type { ZodType } from "zod";
import { HerdrProtocolError } from "./errors";
import { type PongResult, PongResultSchema } from "./schema";
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

  return {
    assertCompatible,
    call,
  };
}

export type HerdrClient = ReturnType<typeof createHerdrClient>;
