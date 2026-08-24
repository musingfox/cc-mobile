import { describe, expect, it } from "bun:test";
import { createHerdrClient } from "./client";
import { HerdrProtocolError, HerdrRpcError } from "./errors";
import type { HerdrRequestOptions, HerdrTransport } from "./transport";
import {
  AGENT_INFO_LINE,
  AGENT_LIST_LINE,
  AGENT_NOT_FOUND_ERROR_LINE,
  OK_LINE,
  PANE_NOT_FOUND_ERROR_LINE,
  PANE_READ_LINE,
  PONG_LINE,
  PONG_PROTOCOL_18_LINE,
  SESSION_SNAPSHOT_LINE,
  TIMEOUT_ERROR_LINE,
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
  it("T1: assertCompatible resolves pong info when the daemon speaks protocol 20", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(PONG_LINE));
    const client = createHerdrClient({ transport });

    const pong = await client.assertCompatible();

    expect(calls[0]?.method).toBe("ping");
    expect(calls[0]?.params).toEqual({});
    expect(pong.version).toBe("0.8.2");
    expect(pong.protocol).toBe(20);
  });

  it("T2: assertCompatible throws HerdrProtocolError naming 18 and 20 on mismatch", async () => {
    const { transport } = fakeTransport(() => resultOf(PONG_PROTOCOL_18_LINE));
    const client = createHerdrClient({ transport });

    const error = await client.assertCompatible().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrProtocolError);
    expect((error as Error).message).toContain("18");
    expect((error as Error).message).toContain("20");
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

    await expect(client.sessionSnapshot()).rejects.toThrow();
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

describe("herdr client: AgentList", () => {
  it("T1: lists all detected agents as validated AgentInfo entries", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(AGENT_LIST_LINE));
    const client = createHerdrClient({ transport });

    const agents = await client.agentList();

    expect(calls[0]?.method).toBe("agent.list");
    expect(calls[0]?.params).toEqual({});
    expect(agents.length).toBe(6);
    const statuses = ["idle", "working", "blocked", "done", "unknown"];
    for (const agent of agents) {
      expect(statuses).toContain(agent.agent_status);
      expect(typeof agent.revision).toBe("number");
    }
  });
});

describe("herdr client: AgentGet", () => {
  it("T1: resolves a single pane's AgentInfo with numeric revision", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(AGENT_INFO_LINE));
    const client = createHerdrClient({ transport });

    const agent = await client.agentGet("wD:p1");

    expect(calls[0]?.method).toBe("agent.get");
    expect(calls[0]?.params).toEqual({ target: "wD:p1" });
    expect(typeof agent.revision).toBe("number");
    expect(agent.pane_id).toBe("wD:p1");
  });

  it("T2: rejects HerdrRpcError agent_not_found when the pane has no detected agent", async () => {
    const { transport } = fakeTransport(() => {
      throw rpcErrorOf(AGENT_NOT_FOUND_ERROR_LINE);
    });
    const client = createHerdrClient({ transport });

    const error = await client.agentGet("w1G:p1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrRpcError);
    expect((error as HerdrRpcError).code).toBe("agent_not_found");
  });
});

describe("herdr client: AgentWait", () => {
  it("T1: passes wire params verbatim, sets read deadline past the daemon timeout, resolves AgentInfo", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(AGENT_INFO_LINE));
    const client = createHerdrClient({ transport });

    const agent = await client.agentWait({ target: "pane-1", until: ["idle"], timeout_ms: 60000 });

    expect(calls[0]?.method).toBe("agent.wait");
    expect(calls[0]?.params).toEqual({ target: "pane-1", until: ["idle"], timeout_ms: 60000 });
    expect(calls[0]?.options?.timeoutMs).toBeGreaterThanOrEqual(65000);
    expect(typeof agent.revision).toBe("number");
  });

  it("T2: surfaces the daemon-side timeout as a typed HerdrRpcError", async () => {
    const { transport } = fakeTransport(() => {
      throw rpcErrorOf(TIMEOUT_ERROR_LINE);
    });
    const client = createHerdrClient({ transport });

    const error = await client
      .agentWait({ target: "pane-1", until: ["idle"], timeout_ms: 500 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HerdrRpcError);
    expect((error as HerdrRpcError).code).toBe("timeout");
  });

  it("T3: without timeout_ms, sends the 60s default on the wire so the daemon deadline exists and fires first", async () => {
    const { transport, calls } = fakeTransport(() => resultOf(AGENT_INFO_LINE));
    const client = createHerdrClient({ transport });

    await client.agentWait({ target: "pane-1", until: ["idle"] });

    // The daemon waits forever when timeout_ms is absent — the resolved budget
    // must reach the wire, and the client deadline must sit strictly past it.
    expect(calls[0]?.params).toEqual({ target: "pane-1", until: ["idle"], timeout_ms: 60000 });
    expect(calls[0]?.options?.timeoutMs).toBe(65000);
  });
});
