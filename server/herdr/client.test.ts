import { describe, expect, it } from "bun:test";
import { createHerdrClient } from "./client";
import { HerdrProtocolError, HerdrRpcError } from "./errors";
import type { HerdrRequestOptions, HerdrTransport } from "./transport";
import {
  OK_LINE,
  PANE_NOT_FOUND_ERROR_LINE,
  PANE_READ_LINE,
  PONG_LINE,
  PONG_PROTOCOL_18_LINE,
  SESSION_SNAPSHOT_LINE,
} from "./wire-fixtures";

/** Extracts the `result` object from a wire fixture line (what the transport resolves to). */
function resultOf(line: string): unknown {
  return (JSON.parse(line) as { result: unknown }).result;
}

/** Builds the HerdrRpcError the transport would raise for an error fixture line. */
function rpcErrorOf(line: string): HerdrRpcError {
  const { error } = JSON.parse(line) as { error: { code: string; message: string } };
  return new HerdrRpcError(error.code, error.message);
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

describe("herdr client: SnapshotQuery", () => {
  it("T1: parses the live snapshot fixture with cursors and tolerates unknown fields", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(SESSION_SNAPSHOT_LINE));
    const client = createHerdrClient({ transport });

    const snapshot = await client.sessionSnapshot();

    expect(calls[0]?.method).toBe("session.snapshot");
    expect(calls[0]?.params).toEqual({});
    expect(snapshot.protocol).toBe(17);
    expect(typeof snapshot.agents[0]?.pane_id).toBe("string");
    expect(typeof snapshot.agents[0]?.revision).toBe("number");
    // unknown top-level fields (workspaces, tabs, panes, layouts) are tolerated, not stripped
    expect((snapshot as Record<string, unknown>).workspaces).toBeDefined();
  });

  it("T2: parses agents omitting agent_session/interactive_ready/state_change_seq", async () => {
    const result = resultOf(SESSION_SNAPSHOT_LINE) as {
      snapshot: { agents: Record<string, unknown>[] };
    };
    for (const agent of result.snapshot.agents) {
      delete agent.agent_session;
      delete agent.interactive_ready;
      delete agent.state_change_seq;
    }
    const { transport } = fakeTransport(() => result);
    const client = createHerdrClient({ transport });

    const snapshot = await client.sessionSnapshot();

    expect(snapshot.agents.length).toBeGreaterThan(0);
    expect(snapshot.agents[0]?.state_change_seq).toBeUndefined();
  });

  it("T3: rejects when an agent entry is missing agent_status", async () => {
    const result = resultOf(SESSION_SNAPSHOT_LINE) as {
      snapshot: { agents: Record<string, unknown>[] };
    };
    delete result.snapshot.agents[0]?.agent_status;
    const { transport } = fakeTransport(() => result);
    const client = createHerdrClient({ transport });

    expect(client.sessionSnapshot()).rejects.toThrow();
  });
});

describe("herdr client: PaneTextInput", () => {
  it("T1: sends exactly one pane.send_text request with verbatim params, no implicit submit", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(OK_LINE));
    const client = createHerdrClient({ transport });

    const result = await client.paneSendText("pane-1", "echo HERDR_SMOKE_OK");

    expect(result).toBeUndefined();
    expect(calls.length).toBe(1);
    expect(calls[0]?.method).toBe("pane.send_text");
    expect(calls[0]?.params).toEqual({ pane_id: "pane-1", text: "echo HERDR_SMOKE_OK" });
    expect(calls.some((c) => c.method === "pane.send_keys")).toBe(false);
  });

  it("T2: rejects HerdrRpcError pane_not_found for an unknown pane", async () => {
    const { transport } = fakeTransport(() => {
      throw rpcErrorOf(PANE_NOT_FOUND_ERROR_LINE);
    });
    const client = createHerdrClient({ transport });

    const error = await client.paneSendText("wZZ:p9", "x").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrRpcError);
    expect((error as HerdrRpcError).code).toBe("pane_not_found");
  });
});

describe("herdr client: PaneKeyInput", () => {
  it("T1: presses named keys with verbatim wire params and resolves void on ok", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(OK_LINE));
    const client = createHerdrClient({ transport });

    const result = await client.paneSendKeys("pane-1", ["Enter"]);

    expect(result).toBeUndefined();
    expect(calls.length).toBe(1);
    expect(calls[0]?.method).toBe("pane.send_keys");
    expect(calls[0]?.params).toEqual({ pane_id: "pane-1", keys: ["Enter"] });
  });
});

describe("herdr client: PaneRead", () => {
  it("T1: forwards the source selector verbatim and returns text + revision", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(PANE_READ_LINE));
    const client = createHerdrClient({ transport });

    const read = await client.paneRead({ pane_id: "pane-1", source: "visible" });

    expect(calls[0]?.method).toBe("pane.read");
    expect(calls[0]?.params).toEqual({ pane_id: "pane-1", source: "visible" });
    expect(read.text.length).toBeGreaterThan(0);
    expect(typeof read.revision).toBe("number");
    expect(read.truncated).toBe(false);
  });

  it("T2: rejects HerdrRpcError pane_not_found for an unknown pane", async () => {
    const { transport } = fakeTransport(() => {
      throw rpcErrorOf(PANE_NOT_FOUND_ERROR_LINE);
    });
    const client = createHerdrClient({ transport });

    const error = await client
      .paneRead({ pane_id: "wZZ:p9", source: "visible" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrRpcError);
    expect((error as HerdrRpcError).code).toBe("pane_not_found");
  });
});
