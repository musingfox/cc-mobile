/**
 * Connection-level failure: connect error (ENOENT/ECONNREFUSED), response
 * deadline exceeded, or the daemon closed the socket without a complete line.
 */
export class HerdrTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HerdrTransportError";
  }
}

/**
 * The daemon speaks an incompatible wire protocol version (herdr is 0.x with
 * no compatibility promise; this client pins one protocol number).
 */
export class HerdrProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HerdrProtocolError";
  }
}

/**
 * Daemon-reported error envelope `{id, error: {code, message}}`.
 * Note: protocol errors may carry an empty `id` — never correlate by id echo.
 */
export class HerdrRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "HerdrRpcError";
    this.code = code;
  }
}

/**
 * What a failed startup probe means. Only a connection-level failure is
 * `unreachable` (the daemon may simply not be up yet); everything else —
 * a protocol mismatch, a reply that fails its schema, an RPC error — means a
 * daemon is there and speaks something this client cannot drive.
 */
export function classifyHerdrFailure(error: unknown): "unreachable" | "incompatible" {
  return error instanceof HerdrTransportError ? "unreachable" : "incompatible";
}
