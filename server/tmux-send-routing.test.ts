import { beforeEach, describe, expect, it } from "bun:test";
import { createPtyResponseRelay } from "./pty-response-relay";
import { createTmuxSendRouting, flattenPrompt, type RunCommand } from "./tmux-send-routing";

// ── C2-Concat ──────────────────────────────────────────────────────────────────

describe("C2-Concat", () => {
  it("T1: given 'a\nb\nc' -> expect 'a b c'", () => {
    expect(flattenPrompt("a\nb\nc")).toBe("a b c");
  });

  it("T2: given 'a\r\nb' -> expect 'a b'", () => {
    expect(flattenPrompt("a\r\nb")).toBe("a b");
  });

  it("T3: given 'a\n' -> expect 'a '", () => {
    expect(flattenPrompt("a\n")).toBe("a ");
  });

  it("T4: given 'plain' -> expect 'plain'", () => {
    expect(flattenPrompt("plain")).toBe("plain");
  });

  it("T5: given '' -> expect ''", () => {
    expect(flattenPrompt("")).toBe("");
  });
});

// ── helpers for other contracts (will expand per contract) ─────────────────────

function makeMockRunCommand() {
  const calls: string[][] = [];
  const run: RunCommand = async (cmd: string, args: string[]) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

function makeMockRelay() {
  const pending = new Map<string, { resolve: (t: string) => void; reject: (e: any) => void }>();
  const relay = {
    awaitResponse: (sessionId: string) => {
      return new Promise<string>((resolve, reject) => {
        // supersede prior like real
        const prior = pending.get(sessionId);
        if (prior) {
          prior.reject(new Error("superseded"));
          pending.delete(sessionId);
        }
        pending.set(sessionId, { resolve, reject });
      });
    },
    resolveResponse: (sessionId: string, text: string) => {
      const entry = pending.get(sessionId);
      if (!entry) return false;
      pending.delete(sessionId);
      entry.resolve(text);
      return true;
    },
    hasPending: (sessionId: string) => pending.has(sessionId),
    cancel: (sessionId: string) => {
      const entry = pending.get(sessionId);
      if (entry) {
        pending.delete(sessionId);
        try {
          entry.reject(new Error("cancelled"));
        } catch {}
      }
    },
    getPendingCount: () => pending.size,
  };
  return { relay, pending };
}

type SinkCall = Record<string, unknown>;
function makeSinkRecorder() {
  const calls: SinkCall[] = [];
  const sink = (msg: SinkCall) => {
    calls.push(msg);
  };
  return { sink, calls };
}

// ── C2-Inject ──────────────────────────────────────────────────────────────────

describe("C2-Inject", () => {
  it("T1: given tmux_send{claudeUuid:'u1', content:'hi'}, u1 registered -> expect runCommand called once with ['send-keys','-t','ccm-u1','hi','Enter']; hasPending('u1')===true", async () => {
    const { run, calls } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const { sink, calls: sinkCalls } = makeSinkRecorder();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    routing.registerClient("u1", sink);
    await routing.send({ claudeUuid: "u1", content: "hi" });

    expect(calls).toEqual([["send-keys", "-t", "ccm-u1", "hi", "Enter"]]);
    expect(routing.hasPending("u1")).toBe(true);
  });

  it("T2: given tmux_send{claudeUuid:'u1', content:'a\nb\nc'} -> expect exactly one send-keys; literal arg 'a b c' (no embedded newline) then 'Enter'; hasPending('u1')===true", async () => {
    const { run, calls } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const { sink } = makeSinkRecorder();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    routing.registerClient("u1", sink);
    await routing.send({ claudeUuid: "u1", content: "a\nb\nc" });

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(["send-keys", "-t", "ccm-u1", "a b c", "Enter"]);
    expect(routing.hasPending("u1")).toBe(true);
  });

  it("T3: given tmux_send{claudeUuid:'ghost'} not registered -> expect runCommand NOT called; hasPending('ghost')===false", async () => {
    const { run, calls } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    // deliberately not register
    await routing.send({ claudeUuid: "ghost", content: "hi" });

    expect(calls.length).toBe(0);
    expect(routing.hasPending("ghost")).toBe(false);
  });
});

// ── C2-DeliverReply (uses pty endpoint handler + relay seam for Stop POST) ────────────

import { createPtyResponseHandler } from "./pty-response-endpoint";

function postReq(body: unknown): Request {
  return new Request("http://x/api/pty-response", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("C2-DeliverReply", () => {
  it("T1: given POST /api/pty-response {session_id:'u1', text:'hi'} with u1 armed -> expect 200 {ok:true}; sink u1 receives stream_chunk chunk.message.content[0].text==='hi' then stream_end; hasPending('u1')===false", async () => {
    const { run } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const { sink, calls: sinkCalls } = makeSinkRecorder();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    routing.registerClient("u1", sink);
    await routing.send({ claudeUuid: "u1", content: "hi" });
    expect(routing.hasPending("u1")).toBe(true);

    const handler = createPtyResponseHandler({ relay: relay as any });
    const res = await handler(postReq({ session_id: "u1", text: "hi" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // .then delivery is microtask; yield
    await Promise.resolve();

    expect(sinkCalls.length).toBe(2);
    const chunkMsg = sinkCalls[0] as any;
    expect(chunkMsg.type).toBe("stream_chunk");
    expect(chunkMsg.chunk.message.content[0].text).toBe("hi");
    expect(sinkCalls[1].type).toBe("stream_end");
    expect(routing.hasPending("u1")).toBe(false);
  });

  it("T2: given POST /api/pty-response {session_id:'u1'} again (no waiter) -> expect 404 {error:'no_pending_response'}; no further sink call", async () => {
    const { run } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const { sink, calls: sinkCalls } = makeSinkRecorder();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    routing.registerClient("u1", sink);
    await routing.send({ claudeUuid: "u1", content: "hi" });

    const handler = createPtyResponseHandler({ relay: relay as any });
    // first delivers
    await handler(postReq({ session_id: "u1", text: "hi" }));
    await Promise.resolve();
    const firstCount = sinkCalls.length;

    // second no waiter
    const res = await handler(postReq({ session_id: "u1" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_pending_response" });

    await Promise.resolve();
    expect(sinkCalls.length).toBe(firstCount); // no further
  });
});

// ── C2-MapRoute ────────────────────────────────────────────────────────────────

describe("C2-MapRoute", () => {
  it("T1: given A tmux_send(uuidA), B tmux_send(uuidB), then POST {session_id:uuidA} -> expect sinkA called once, sinkB called 0 times", async () => {
    const { run } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const { sink: sinkA, calls: callsA } = makeSinkRecorder();
    const { sink: sinkB, calls: callsB } = makeSinkRecorder();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    routing.registerClient("uuidA", sinkA);
    routing.registerClient("uuidB", sinkB);
    await routing.send({ claudeUuid: "uuidA", content: "promptA" });
    await routing.send({ claudeUuid: "uuidB", content: "promptB" });

    const handler = createPtyResponseHandler({ relay: relay as any });
    await handler(postReq({ session_id: "uuidA", text: "fromA" }));
    await Promise.resolve();

    expect(callsA.length).toBe(2); // chunk + end
    expect(callsB.length).toBe(0);
  });

  it("T2: given then POST {session_id:uuidB} -> expect sinkB called once, sinkA total still 1", async () => {
    const { run } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const { sink: sinkA, calls: callsA } = makeSinkRecorder();
    const { sink: sinkB, calls: callsB } = makeSinkRecorder();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    routing.registerClient("uuidA", sinkA);
    routing.registerClient("uuidB", sinkB);
    await routing.send({ claudeUuid: "uuidA", content: "promptA" });
    await routing.send({ claudeUuid: "uuidB", content: "promptB" });

    const handler = createPtyResponseHandler({ relay: relay as any });
    await handler(postReq({ session_id: "uuidA", text: "fromA" }));
    await Promise.resolve();
    const aCountAfterFirst = callsA.length;

    await handler(postReq({ session_id: "uuidB", text: "fromB" }));
    await Promise.resolve();

    expect(callsB.length).toBe(2);
    expect(callsA.length).toBe(aCountAfterFirst); // still 2, no more
  });
});

// ── C2-Teardown ────────────────────────────────────────────────────────────────

describe("C2-Teardown", () => {
  it("T1: given arm 'u1' via tmux_send, then tmux_teardown{claudeUuid:'u1'} -> expect hasPending('u1')===false; map.get('u1')===undefined", async () => {
    const { run } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const { sink } = makeSinkRecorder();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    routing.registerClient("u1", sink);
    await routing.send({ claudeUuid: "u1", content: "hi" });
    expect(routing.hasPending("u1")).toBe(true);
    expect(routing.getClient("u1")).toBeDefined();

    routing.teardown("u1");

    expect(routing.hasPending("u1")).toBe(false);
    expect(routing.getClient("u1")).toBeUndefined();
  });

  it("T2: given then POST /api/pty-response {session_id:'u1'} -> expect 404 {error:'no_pending_response'}", async () => {
    const { run } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const { sink } = makeSinkRecorder();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    routing.registerClient("u1", sink);
    await routing.send({ claudeUuid: "u1", content: "hi" });
    routing.teardown("u1");

    const handler = createPtyResponseHandler({ relay: relay as any });
    const res = await handler(postReq({ session_id: "u1", text: "late" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_pending_response" });
  });
});

// ── C2-CloseCleanup ──────────────────────────────────────────────────────────────

describe("C2-CloseCleanup", () => {
  it("T1: cleanupByOwner(wsA) clears only wsA's bindings; wsB's binding survives", async () => {
    const { run } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const { sink: sinkA } = makeSinkRecorder();
    const { sink: sinkB } = makeSinkRecorder();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    const wsA = { id: "A" };
    const wsB = { id: "B" };
    routing.registerClient("u1", sinkA, wsA);
    routing.registerClient("u2", sinkB, wsB);
    // arm waiters so hasPending is true for both
    await routing.send({ claudeUuid: "u1", content: "hi" });
    await routing.send({ claudeUuid: "u2", content: "hi" });
    expect(routing.hasPending("u1")).toBe(true);
    expect(routing.hasPending("u2")).toBe(true);

    routing.cleanupByOwner(wsA);

    expect(routing.getClient("u1")).toBeUndefined();
    expect(routing.hasPending("u1")).toBe(false);
    expect(routing.getClient("u2")).toBeDefined();
    expect(routing.hasPending("u2")).toBe(true);
  });

  it("T2: cleanupByOwner on an owner with no bindings does not throw", () => {
    const { run } = makeMockRunCommand();
    const { relay } = makeMockRelay();
    const routing = createTmuxSendRouting({ runCommand: run, responseRelay: relay });

    expect(() => routing.cleanupByOwner({ id: "nobody" })).not.toThrow();
  });
});
