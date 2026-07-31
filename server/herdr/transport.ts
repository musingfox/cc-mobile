import { homedir } from "node:os";
import { join } from "node:path";
import { HerdrRpcError, HerdrTransportError } from "./errors";
import { ErrorEnvelopeSchema, ResultEnvelopeSchema } from "./schema";

// ---------------------------------------------------------------------------
// One-shot herdr RPC transport.
//
// Wire facts (probe-verified, live daemon 0.7.5 / protocol 17):
// - NOT JSON-RPC 2.0: request `{id, method, params}` + "\n", one line back.
// - The daemon closes the socket after every response — one fresh connection
//   per RPC, correlation is per-connection (never by id echo; errors may
//   carry `id: ""`).
// - Responses can span multiple TCP chunks; buffer to the first "\n".
// - The daemon enforces a ~5s initial-request deadline: write immediately on
//   connection open.
// ---------------------------------------------------------------------------

export interface HerdrConnection {
  write(data: string): void;
  end(): void;
}

export interface HerdrConnectHandlers {
  onData(chunk: string | Uint8Array): void;
  onClose(): void;
  onError(error: Error): void;
}

/** DI seam: opens a connection with handlers attached before any data can arrive. */
export type HerdrConnect = (handlers: HerdrConnectHandlers) => Promise<HerdrConnection>;

export type TimerHandle = unknown;
export type SetTimeoutFn = (fn: () => void, ms: number) => TimerHandle;
export type ClearTimeoutFn = (handle: TimerHandle) => void;

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function resolveSocketPath(explicit?: string): string {
  return (
    explicit ?? process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config", "herdr", "herdr.sock")
  );
}

export function createUnixConnect(socketPath: string): HerdrConnect {
  return async (handlers) => {
    const socket = await Bun.connect({
      unix: socketPath,
      socket: {
        data(_socket, chunk) {
          handlers.onData(chunk);
        },
        close() {
          handlers.onClose();
        },
        error(_socket, error) {
          handlers.onError(error);
        },
      },
    });
    return {
      write(data: string) {
        socket.write(data);
      },
      end() {
        socket.end();
      },
    };
  };
}

/** Incremental newline splitter; multibyte-safe across chunk boundaries. */
export function createLineSplitter(): (chunk: string | Uint8Array) => string[] {
  let buffer = "";
  const decoder = new TextDecoder();
  return (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines: string[] = [];
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      lines.push(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
    return lines;
  };
}

export interface HerdrRequestOptions {
  /** Per-call response deadline; defaults to DEFAULT_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

export interface HerdrTransport {
  request(method: string, params: unknown, options?: HerdrRequestOptions): Promise<unknown>;
}

export interface HerdrTransportOptions {
  socketPath?: string;
  connect?: HerdrConnect;
  defaultTimeoutMs?: number;
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
}

export function createHerdrTransport(options: HerdrTransportOptions = {}): HerdrTransport {
  const connect = options.connect ?? createUnixConnect(resolveSocketPath(options.socketPath));
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const setTimeoutFn: SetTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn: ClearTimeoutFn =
    options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let nextId = 0;

  function request(
    method: string,
    params: unknown,
    requestOptions: HerdrRequestOptions = {},
  ): Promise<unknown> {
    const timeoutMs = requestOptions.timeoutMs ?? defaultTimeoutMs;
    nextId += 1;
    const id = `req-${nextId}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      let connection: HerdrConnection | undefined;
      let timer: TimerHandle | undefined;
      const splitLines = createLineSplitter();

      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeoutFn(timer);
        finish();
        connection?.end();
      };

      const handlers: HerdrConnectHandlers = {
        onData(chunk) {
          const [line] = splitLines(chunk);
          if (line === undefined) return;
          settle(() => {
            let raw: unknown;
            try {
              raw = JSON.parse(line);
            } catch (error) {
              reject(
                new HerdrTransportError(`herdr ${method}: unparseable response line`, {
                  cause: error,
                }),
              );
              return;
            }
            const errorEnvelope = ErrorEnvelopeSchema.safeParse(raw);
            if (errorEnvelope.success) {
              reject(
                new HerdrRpcError(errorEnvelope.data.error.code, errorEnvelope.data.error.message),
              );
              return;
            }
            const resultEnvelope = ResultEnvelopeSchema.safeParse(raw);
            if (resultEnvelope.success) {
              resolve(resultEnvelope.data.result);
            } else {
              reject(
                new HerdrTransportError(`herdr ${method}: malformed response envelope`, {
                  cause: resultEnvelope.error,
                }),
              );
            }
          });
        },
        onClose() {
          settle(() =>
            reject(
              new HerdrTransportError(
                `herdr ${method}: connection closed before a complete response line`,
              ),
            ),
          );
        },
        onError(error) {
          settle(() =>
            reject(
              new HerdrTransportError(`herdr ${method}: socket error: ${error.message}`, {
                cause: error,
              }),
            ),
          );
        },
      };

      (async () => {
        connection = await connect(handlers);
        // Write immediately on open: the daemon drops connections that do not
        // send a request within ~5s.
        connection.write(`${JSON.stringify({ id, method, params })}\n`);
        if (!settled) {
          timer = setTimeoutFn(() => {
            settle(() =>
              reject(new HerdrTransportError(`herdr ${method}: no response within ${timeoutMs}ms`)),
            );
          }, timeoutMs);
        }
      })().catch((error: unknown) => {
        settle(() =>
          reject(
            new HerdrTransportError(
              `herdr ${method}: connect failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            ),
          ),
        );
      });
    });
  }

  return { request };
}
