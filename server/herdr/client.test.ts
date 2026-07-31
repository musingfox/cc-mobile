import { describe, expect, it } from "bun:test";
import { createHerdrClient } from "./client";
import { HerdrProtocolError } from "./errors";
import type { HerdrRequestOptions, HerdrTransport } from "./transport";
import { PONG_LINE, PONG_PROTOCOL_18_LINE, SESSION_SNAPSHOT_LINE } from "./wire-fixtures";

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
