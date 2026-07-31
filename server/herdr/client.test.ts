import { describe, expect, it } from "bun:test";
import { createHerdrClient } from "./client";
import { HerdrProtocolError } from "./errors";
import type { HerdrRequestOptions, HerdrTransport } from "./transport";
import { PONG_LINE, PONG_PROTOCOL_18_LINE } from "./wire-fixtures";

/** Extracts the `result` object from a wire fixture line (what the transport resolves to). */
function resultOf(line: string): unknown {
  return (JSON.parse(line) as { result: unknown }).result;
}

interface RecordedCall {
  method: string;
  params: unknown;
  options?: HerdrRequestOptions;
}

/**
 * Fake transport: records every call and replies via the handler
 * (return = resolved result object, throw = rejection).
 */
function fakeTransport(handler: (call: RecordedCall) => unknown) {
  const calls: RecordedCall[] = [];
  const transport: HerdrTransport = {
    async request(method, params, options) {
      const call: RecordedCall = { method, params, options };
      calls.push(call);
      return handler(call);
    },
  };
  return { transport, calls };
}

describe("herdr client: ProtocolHandshake", () => {
  it("T1: assertCompatible resolves pong info when the daemon speaks protocol 17", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(PONG_LINE));
    const client = createHerdrClient({ transport });

    const pong = await client.assertCompatible();

    expect(calls[0]?.method).toBe("ping");
    expect(calls[0]?.params).toEqual({});
    expect(pong.version).toBe("0.7.5");
    expect(pong.protocol).toBe(17);
  });

  it("T2: assertCompatible throws HerdrProtocolError naming 17 and 18 on mismatch", async () => {
    const { transport } = fakeTransport(() => resultOf(PONG_PROTOCOL_18_LINE));
    const client = createHerdrClient({ transport });

    const error = await client.assertCompatible().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrProtocolError);
    expect((error as Error).message).toContain("17");
    expect((error as Error).message).toContain("18");
  });
});
