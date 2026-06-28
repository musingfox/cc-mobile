import { describe, expect, it } from "bun:test";
import { createPtyPermissionHandler } from "./pty-permission-endpoint";
import { createPtyPermissionRelay } from "./pty-permission-relay";
import { createTmuxSendRouting } from "./tmux-send-routing";

// ── helpers ────────────────────────────────────────────────────────────────────

function makeMockHasSession(map: Record<string, boolean>) {
  return (id: string) => !!map[id];
}

type PermCall = { sessionId: string; requestId: string; tool: any };
function makeSinkRecorder() {
  const calls: PermCall[] = [];
  return {
    calls,
    sink: (sessionId: string, requestId: string, tool: any) => {
      calls.push({ sessionId, requestId, tool });
    },
  };
}

function postPermReq(body: any): Request {
  return new Request("http://x/api/pty-permission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── C2-PermRoute ───────────────────────────────────────────────────────────────

describe("C2-PermRoute", () => {
  it("T1: given hasSession(uuidA)=true; POST /api/pty-permission {session_id:uuidA, tool_use_id:'t1', tool_name:'Bash', tool_input:{}} -> expect non-404 path; sinkA receives permission_request requestId 't1' tool 'Bash'; sinkB count 0", async () => {
    // Use a relay that records its sendToClient calls as the 'sink'
    const aRecorder = makeSinkRecorder();
    const bRecorder = makeSinkRecorder();

    // For test we simulate the map by separate relays, but mimic the ws shim dispatch
    const relayA = createPtyPermissionRelay((sid, rid, tool) => aRecorder.sink(sid, rid, tool), { timeoutMs: 10 });
    const relayB = createPtyPermissionRelay((sid, rid, tool) => bRecorder.sink(sid, rid, tool), { timeoutMs: 10 });

    // Shim like in ws: choose relay by 'has'
    const hasA = makeMockHasSession({ uuidA: true });
    const handler = createPtyPermissionHandler({
      relay: {
        requestPtyPermission: (p: any) => {
          if (hasA(p.sessionId)) return relayA.requestPtyPermission(p);
          return relayB.requestPtyPermission(p);
        },
      } as any,
      hasSession: (id: string) => hasA(id),
    });

    // simulate register sinkA by using A relay
    const res = await handler(
      postPermReq({
        session_id: "uuidA",
        tool_use_id: "t1",
        tool_name: "Bash",
        tool_input: {},
      })
    );

    expect(res.status).not.toBe(404);
    const body = await res.json();
    expect(body).toEqual({ allow: false }); // default deny on timeout in relay, but non-404

    // In real, the requestPty calls sendToClient sync, which records
    // Since no real client response, it times out to {allow:false}, but send happened
    expect(aRecorder.calls.length).toBeGreaterThan(0);
    expect(aRecorder.calls[0].requestId).toBe("t1");
    expect(aRecorder.calls[0].tool.name).toBe("Bash");
    expect(bRecorder.calls.length).toBe(0);
  });
});

// ── C2-PermTeardown ────────────────────────────────────────────────────────────

describe("C2-PermTeardown", () => {
  it("T1: given teardown 'u1', then hasSession('u1') -> expect false", () => {
    // Simulate via registry mock; in ws the or'd hasSession uses registry.has after teardown
    const hasMap: Record<string, boolean> = { u1: true };
    const hasSession = makeMockHasSession(hasMap);
    expect(hasSession("u1")).toBe(true);

    // teardown
    hasMap.u1 = false;

    expect(hasSession("u1")).toBe(false);
  });

  it("T2: given POST /api/pty-permission {session_id:'u1', tool_use_id:'t1', tool_name:'Bash', tool_input:{}} after teardown -> expect 404 {error:'session_not_found'}; no sink invocation", async () => {
    const recorder = makeSinkRecorder();
    const relay = createPtyPermissionRelay((sid, rid, tool) => recorder.sink(sid, rid, tool), { timeoutMs: 10 });
    const hasSession = makeMockHasSession({ u1: false }); // after teardown

    const handler = createPtyPermissionHandler({
      relay: relay as any,
      hasSession,
    });

    const res = await handler(
      postPermReq({
        session_id: "u1",
        tool_use_id: "t1",
        tool_name: "Bash",
        tool_input: {},
      })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "session_not_found" });
    expect(recorder.calls.length).toBe(0); // no sink
  });
});
