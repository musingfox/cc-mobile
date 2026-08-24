import { describe, expect, it } from "bun:test";
import { HerdrRpcError, HerdrTransportError } from "./errors";
import {
  createHerdrTransport,
  type HerdrConnect,
  type HerdrConnectHandlers,
  type HerdrConnection,
} from "./transport";
import {
  INVALID_REQUEST_EMPTY_ID_ERROR_LINE,
  PONG_LINE,
  SESSION_SNAPSHOT_LINE,
} from "./wire-fixtures";

/**
 * Fake connect factory: on each write, replies with `line + "\n"` split into
 * byte-sized chunks (default: single chunk), then closes the connection —
 * mirroring the daemon's one-request-per-connection behavior.
 */
function fakeReplyConnect(line: string, options: { chunkBytes?: number } = {}) {
  const connections: { written: string[] }[] = [];
  const connect: HerdrConnect = async (handlers: HerdrConnectHandlers) => {
    const record = { written: [] as string[] };
    connections.push(record);
    return {
      write(data: string) {
        record.written.push(data);
        const payload = Buffer.from(`${line}\n`, "utf8");
        const chunkBytes = options.chunkBytes ?? payload.length;
        queueMicrotask(() => {
          for (let offset = 0; offset < payload.length; offset += chunkBytes) {
            handlers.onData(payload.subarray(offset, offset + chunkBytes));
          }
          handlers.onClose();
        });
      },
      end() {},
    } satisfies HerdrConnection;
  };
  return { connect, connections };
}

describe("herdr transport (RpcRoundTrip)", () => {
  it("T1: resolves a pong result envelope from a single chunk", async () => {
    const { connect } = fakeReplyConnect(PONG_LINE);
    const transport = createHerdrTransport({ connect });

    const result = (await transport.request("ping", {})) as Record<string, unknown>;

    expect(result.type).toBe("pong");
    expect(result.version).toBe("0.8.2");
  });

  it("T2: line-buffers a ~13KB response delivered in 8192-byte chunks", async () => {
    expect(Buffer.byteLength(SESSION_SNAPSHOT_LINE, "utf8")).toBeGreaterThan(8192);
    const { connect } = fakeReplyConnect(SESSION_SNAPSHOT_LINE, { chunkBytes: 8192 });
    const transport = createHerdrTransport({ connect });

    const result = (await transport.request("session.snapshot", {})) as Record<string, unknown>;

    expect(result.type).toBe("session_snapshot");
  });

  it("T3: rejects HerdrRpcError on an error envelope with empty id", async () => {
    const { connect } = fakeReplyConnect(INVALID_REQUEST_EMPTY_ID_ERROR_LINE);
    const transport = createHerdrTransport({ connect });

    const error = await transport.request("pane.read", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrRpcError);
    expect((error as HerdrRpcError).code).toBe("invalid_request");
  });

  it("T4: opens one fresh connection per request", async () => {
    const { connect, connections } = fakeReplyConnect(PONG_LINE);
    const transport = createHerdrTransport({ connect });

    await transport.request("ping", {});
    await transport.request("ping", {});

    expect(connections.length).toBe(2);
  });

  it("T5: wraps connect factory failure (ENOENT) in HerdrTransportError", async () => {
    const connect: HerdrConnect = async () => {
      throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    };
    const transport = createHerdrTransport({ connect });

    const error = await transport.request("ping", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrTransportError);
  });

  it("T6: rejects HerdrTransportError when the connection closes before any newline", async () => {
    const connect: HerdrConnect = async (handlers) => ({
      write() {
        queueMicrotask(() => {
          handlers.onData('{"id":"x","resu');
          handlers.onClose();
        });
      },
      end() {},
    });
    const transport = createHerdrTransport({ connect });

    const error = await transport.request("ping", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrTransportError);
  });

  it("T7: writes the request line immediately on connection open, before any timer", async () => {
    const events: string[] = [];
    let written = "";
    const connect: HerdrConnect = async (handlers) => {
      events.push("open");
      return {
        write(data: string) {
          events.push("write");
          written = data;
          queueMicrotask(() => {
            handlers.onData(`${PONG_LINE}\n`);
            handlers.onClose();
          });
        },
        end() {},
      };
    };
    const transport = createHerdrTransport({
      connect,
      setTimeoutFn: (fn, ms) => {
        events.push("timer");
        return setTimeout(fn, ms);
      },
    });

    await transport.request("ping", {});

    expect(events.indexOf("write")).toBe(events.indexOf("open") + 1);
    expect(events.indexOf("timer")).toBeGreaterThan(events.indexOf("write"));
    expect(written.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.method).toBe("ping");
    expect(parsed.params).toEqual({});
    expect(typeof parsed.id).toBe("string");
  });
});
