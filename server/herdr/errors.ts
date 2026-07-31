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
