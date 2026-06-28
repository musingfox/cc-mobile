/**
 * tmux-unattended-relay.test.ts — unattended-safety behavior of the tmux permission
 * relay + sink-rebind interaction, with an injected fake clock (no real timers, no tmux).
 *
 *   EX-A0: when the sink is missing (getClient -> undefined), the relay never resolves
 *          {allow:true}; advancing to the timeout resolves {allow:false}.
 *   EX-A1: pausePending() on an in-flight request returns a snapshot (toolUseId+sessionId
 *          +elapsedMs) without resolving the promise; getPendingCount stays >=1.
 *   EX-A2 (relay): with timeoutMs=90000, advancing 89999ms does not resolve; 90000ms denies.
 *   EX-C1: sink-rebind regression lock — register(ws1) -> cleanup(ws1) -> register(ws2),
 *          then a resolved response reaches ONLY ws2's sink (stream_chunk + stream_end).
 *   EX-C2: frozen-countdown — pausePending snapshot, rebind to ws2, resumePending re-fires
 *          permission_request to ws2 (same toolUseId); advancing the remaining time denies.
 *          An already-expired snapshot is not re-fired and is denied immediately.
 *
 * Mirrors tmux-permission-routing.test.ts style. Does NOT modify relay/routing impls.
 */

import { describe, expect, it } from "bun:test";
import { createPtyPermissionRelay } from "./pty-permission-relay";
import { createPtyResponseRelay } from "./pty-response-relay";
import { createTmuxSendRouting } from "./tmux-send-routing";

// ── fake clock ─────────────────────────────────────────────────────────────────

function makeFakeClock(startMs = 1_000_000) {
  let now = startMs;
  type Timer = { id: number; fireAt: number; fn: () => void; cleared: boolean };
  const timers: Timer[] = [];
  let nextId = 1;

  const setTimeoutFn = (fn: () => void, ms: number) => {
    const t: Timer = { id: nextId++, fireAt: now + ms, fn, cleared: false };
    timers.push(t);
    return t.id;
  };
  const clearTimeoutFn = (id: unknown) => {
    const t = timers.find((x) => x.id === id);
    if (t) t.cleared = true;
  };
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers) {
      if (!t.cleared && t.fireAt <= now) {
        t.cleared = true;
        t.fn();
      }
    }
  };
  return {
    setTimeoutFn,
    clearTimeoutFn,
    advance,
    nowFn: () => now,
  };
}

// Bun:test does not let us override Date.now per-relay; relay computes elapsed via
// Date.now(). For elapsed-based assertions we use real Date.now diffs that are ~0
// (synchronous), and assert on the >=0 / structural properties the contract names.

// ── recorder sink ────────────────────────────────────────────────────────────

function makeRecorder() {
  const msgs: Array<Record<string, unknown>> = [];
  return { msgs, sink: (m: Record<string, unknown>) => msgs.push(m) };
}

// ── EX-A0: sink missing never grants ──────────────────────────────────────────

describe("EX-A0: missing sink never auto-allows", () => {
  it("when getClient->undefined the relay never resolves {allow:true}; timeout denies", async () => {
    const clock = makeFakeClock();
    // routing with no registered client => getClient returns undefined
    const routing = createTmuxSendRouting({ responseRelay: createPtyResponseRelay() });

    let sendCalls = 0;
    const relay = createPtyPermissionRelay(
      (sessionId, requestId, tool) => {
        sendCalls++;
        const sink = routing.getClient(sessionId);
        // mirror ws.ts: only deliver if a sink exists
        if (sink) sink({ type: "permission_request", sessionId, requestId, tool });
      },
      { timeoutMs: 90000, setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn },
    );

    let resolved: { allow: boolean } | null = null;
    relay
      .requestPtyPermission({
        sessionId: "uuidX",
        toolUseId: "t1",
        toolName: "Bash",
        toolInput: {},
      })
      .then((r) => {
        resolved = r;
      });

    // sendToClient was attempted, but no sink existed -> nothing delivered, no allow
    expect(sendCalls).toBe(1);
    expect(routing.getClient("uuidX")).toBeUndefined();

    // advance just short of timeout: still no resolution, definitely never {allow:true}
    clock.advance(89999);
    await Promise.resolve();
    expect(resolved).toBeNull();

    // reach timeout -> deny
    clock.advance(1);
    await Promise.resolve();
    expect(resolved).toEqual({ allow: false });
  });
});

// ── EX-A1: pause snapshot without resolving ────────────────────────────────────

describe("EX-A1: pausePending snapshots in-flight request", () => {
  it("returns snapshot with toolUseId+sessionId+elapsedMs, leaves promise pending, count>=1", async () => {
    const clock = makeFakeClock();
    const rec = makeRecorder();
    const relay = createPtyPermissionRelay(
      (sessionId, requestId, tool) =>
        rec.sink({ type: "permission_request", sessionId, requestId, tool }),
      { timeoutMs: 90000, setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn },
    );

    let resolved: unknown = null;
    relay
      .requestPtyPermission({
        sessionId: "uuidA",
        toolUseId: "tA",
        toolName: "Bash",
        toolInput: { cmd: "ls" },
      })
      .then((r) => {
        resolved = r;
      });

    expect(relay.getPendingCount()).toBeGreaterThanOrEqual(1);

    const snaps = relay.pausePending();
    expect(snaps.length).toBe(1);
    expect(snaps[0].toolUseId).toBe("tA");
    expect(snaps[0].sessionId).toBe("uuidA");
    expect(typeof snaps[0].elapsedMs).toBe("number");
    expect(snaps[0].elapsedMs).toBeGreaterThanOrEqual(0);

    // promise still unresolved; pause does not delete the entry
    await Promise.resolve();
    expect(resolved).toBeNull();
    expect(relay.getPendingCount()).toBeGreaterThanOrEqual(1);
  });
});

// ── EX-A2 (relay): 90s timeout boundary ────────────────────────────────────────

describe("EX-A2 relay: 90000ms timeout boundary", () => {
  it("does not resolve at 89999ms, denies at 90000ms", async () => {
    const clock = makeFakeClock();
    const relay = createPtyPermissionRelay(() => {}, {
      timeoutMs: 90000,
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    });

    let resolved: { allow: boolean } | null = null;
    relay
      .requestPtyPermission({ sessionId: "s", toolUseId: "t", toolName: "Bash", toolInput: {} })
      .then((r) => {
        resolved = r;
      });

    clock.advance(89999);
    await Promise.resolve();
    expect(resolved).toBeNull();

    clock.advance(1);
    await Promise.resolve();
    expect(resolved).toEqual({ allow: false });
  });
});

// ── EX-C1: sink-rebind regression lock ─────────────────────────────────────────

describe("EX-C1: response routes only to the current (rebound) sink", () => {
  it("register(ws1) -> cleanup(ws1) -> register(ws2); resolved response reaches only ws2", async () => {
    const responseRelay = createPtyResponseRelay();
    const routing = createTmuxSendRouting({
      responseRelay,
      // no real tmux: stub runCommand
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    });

    const ws1 = { id: "ws1" };
    const ws2 = { id: "ws2" };
    const rec1 = makeRecorder();
    const rec2 = makeRecorder();

    routing.registerClient("uuidC", rec1.sink, ws1);
    routing.cleanupByOwner(ws1);
    routing.registerClient("uuidC", rec2.sink, ws2);

    // arm + send (send-keys stubbed); response relay now has a pending waiter
    await routing.send({ claudeUuid: "uuidC", content: "hello" });
    expect(responseRelay.hasPending("uuidC")).toBe(true);

    // Stop hook delivers the reply
    responseRelay.resolveResponse("uuidC", "world");
    await Promise.resolve();
    await Promise.resolve();

    // ws1 saw nothing; ws2 saw stream_chunk + stream_end
    expect(rec1.msgs.length).toBe(0);
    const types = rec2.msgs.map((m) => m.type);
    expect(types).toContain("stream_chunk");
    expect(types).toContain("stream_end");
  });
});

// ── EX-C2: frozen-countdown across rebind ───────────────────────────────────────

describe("EX-C2: frozen countdown re-fires to rebound sink", () => {
  it("pause -> rebind ws2 -> resume re-fires permission_request to ws2 (same toolUseId); remaining-time deny", async () => {
    const clock = makeFakeClock();
    const routing = createTmuxSendRouting({ responseRelay: createPtyResponseRelay() });

    const ws1 = { id: "ws1" };
    const ws2 = { id: "ws2" };
    const rec1 = makeRecorder();
    const rec2 = makeRecorder();

    const relay = createPtyPermissionRelay(
      (sessionId, requestId, tool) => {
        const sink = routing.getClient(sessionId);
        if (sink) sink({ type: "permission_request", sessionId, requestId, tool });
      },
      { timeoutMs: 90000, setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn },
    );

    // ws1 owns the session; permission requested -> ws1 sees it
    routing.registerClient("uuidD", rec1.sink, ws1);
    let resolved: { allow: boolean } | null = null;
    relay
      .requestPtyPermission({
        sessionId: "uuidD",
        toolUseId: "tD",
        toolName: "Bash",
        toolInput: {},
      })
      .then((r) => {
        resolved = r;
      });
    expect(rec1.msgs.filter((m) => m.type === "permission_request").length).toBe(1);

    // disconnect: pause snapshot (timer frozen)
    const snaps = relay.pausePending();
    expect(snaps[0].toolUseId).toBe("tD");

    // rebind to ws2
    routing.cleanupByOwner(ws1);
    routing.registerClient("uuidD", rec2.sink, ws2);

    // resume re-fires to ws2's sink with same toolUseId
    relay.resumePending(snaps);
    const ws2perms = rec2.msgs.filter((m) => m.type === "permission_request");
    expect(ws2perms.length).toBe(1);
    expect((ws2perms[0] as any).requestId).toBe("tD");

    // advancing the remaining time eventually denies
    clock.advance(90000);
    await Promise.resolve();
    expect(resolved).toEqual({ allow: false });
  });

  it("an already-expired snapshot is not re-fired and is denied immediately on resume", async () => {
    const clock = makeFakeClock();
    const routing = createTmuxSendRouting({ responseRelay: createPtyResponseRelay() });
    const ws2 = { id: "ws2" };
    const rec2 = makeRecorder();

    const relay = createPtyPermissionRelay(
      (sessionId, requestId, tool) => {
        const sink = routing.getClient(sessionId);
        if (sink) sink({ type: "permission_request", sessionId, requestId, tool });
      },
      { timeoutMs: 90000, setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn },
    );

    let resolved: { allow: boolean } | null = null;
    relay
      .requestPtyPermission({
        sessionId: "uuidE",
        toolUseId: "tE",
        toolName: "Bash",
        toolInput: {},
      })
      .then((r) => {
        resolved = r;
      });

    // craft an expired snapshot (elapsed >= timeout)
    const snaps = relay.pausePending();
    const expired = [{ ...snaps[0], elapsedMs: 90000 }];

    routing.registerClient("uuidE", rec2.sink, ws2);
    relay.resumePending(expired);
    await Promise.resolve();

    // immediate deny, no re-fire to the new sink
    expect(resolved).toEqual({ allow: false });
    expect(rec2.msgs.filter((m) => m.type === "permission_request").length).toBe(0);
  });
});
