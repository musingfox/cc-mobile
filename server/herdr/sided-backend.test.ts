import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyAgentProfileSource } from "../agents/profiles";
import { ClientMessage } from "../protocol";
import { handleTerminalCreate } from "../terminal-control";
import type { HerdrTerminalBackend } from "./backend";
import { createSidedBackend } from "./sided-backend";
import type { SocketWatch } from "./socket-watch";

type Calls = Record<string, unknown[][]>;

function fakeBackend(overrides: Record<string, unknown> = {}) {
  const calls: Calls = {};
  const rec =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      calls[name] = [...(calls[name] ?? []), args];
      return typeof result === "function"
        ? (result as (...a: unknown[]) => unknown)(...args)
        : result;
    };
  const names: Record<string, unknown> = {
    createSession: Promise.resolve({ name: "n", paneRef: "w9:p1" }),
    hasSession: { present: false },
    listLive: [],
    teardown: Promise.resolve({ killed: true }),
    teardownAll: Promise.resolve(),
    send: Promise.resolve(),
    registerClient: undefined,
    getClient: undefined,
    cleanupByOwner: undefined,
    start: Promise.resolve(),
    listSessionDescriptors: Promise.resolve([]),
    listSessionsOutcome: Promise.resolve({ ok: true, sessions: [] }),
    listStates: Promise.resolve({}),
    integrationStates: Promise.resolve({ claude: "current" }),
    readTranscriptPage: Promise.resolve(null),
    resolvePermission: Promise.resolve(true),
    paneIdForRequest: undefined,
    isPermissionCurrent: false,
    permissionAutoDenyMs: undefined,
    pausePermissions: undefined,
    resumePermissions: Promise.resolve(),
    pushSubscriberCount: 0,
    readCapabilities: Promise.resolve({ ok: false, reason: "failed" }),
    paneCwd: Promise.resolve(null),
    ...overrides,
  };
  const backend: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(names)) backend[k] = rec(k, v);
  return { backend: backend as unknown as HerdrTerminalBackend, calls };
}

function fakeWatch(status: string = "online") {
  const calls = { start: 0, stop: 0 };
  const watch = {
    start: () => void calls.start++,
    stop: () => void calls.stop++,
    status: () => status,
  } as unknown as SocketWatch;
  return { watch, calls };
}

const desc = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  sessionId,
  workspaceId: "w1",
  agentSessionValue: null,
  cwd: "/a",
  origin: "self",
  ...extra,
});

function make(
  c: Record<string, unknown> = {},
  h: Record<string, unknown> | null = {},
  opts: { warn?: (m: string) => void; cw?: SocketWatch; hw?: SocketWatch } = {},
) {
  const cockpit = fakeBackend(c);
  const hangar = h === null ? null : fakeBackend(h);
  const sided = createSidedBackend({
    cockpit: { backend: cockpit.backend, watch: opts.cw },
    hangar: hangar ? { name: "fleet", backend: hangar.backend, watch: opts.hw } : undefined,
    warn: opts.warn,
  });
  return { sided, cockpit, hangar: hangar as NonNullable<typeof hangar> };
}

describe("HangarFramesCarryPrefixedKey", () => {
  function registered() {
    const { sided, hangar } = make();
    const got: Record<string, unknown>[] = [];
    const owner = {};
    sided.registerClient("fleet@w1:p1", (f) => void got.push(f), owner);
    const args = hangar.calls.registerClient[0];
    return { got, args, owner, wrapped: args[1] as (f: Record<string, unknown>) => void };
  }
  test("T1 rewrites sessionId", () => {
    const { got, args, owner, wrapped } = registered();
    expect(args[0]).toBe("w1:p1");
    expect(typeof args[1]).toBe("function");
    expect(args[2]).toBe(owner);
    wrapped({ type: "session_state", sessionId: "w1:p1", state: "running" });
    expect(got[0]).toEqual({ type: "session_state", sessionId: "fleet@w1:p1", state: "running" });
  });
  test("T2 permission_request fields untouched", () => {
    const { got, wrapped } = registered();
    wrapped({
      type: "permission_request",
      sessionId: "w1:p1",
      requestId: "perm-1",
      options: [{ id: "1" }],
    });
    expect(got[0]).toEqual({
      type: "permission_request",
      sessionId: "fleet@w1:p1",
      requestId: "perm-1",
      options: [{ id: "1" }],
    });
  });
  test("T3 stream_chunk only sessionId changes", () => {
    const { got, wrapped } = registered();
    const chunk = { recordId: "r1", seq: 10, epoch: "e" };
    wrapped({ type: "stream_chunk", sessionId: "w1:p1", chunk });
    expect(got[0]).toEqual({ type: "stream_chunk", sessionId: "fleet@w1:p1", chunk });
  });
  test("T4 no sessionId forwarded", () => {
    const { got, wrapped } = registered();
    wrapped({ type: "replay_complete" });
    expect(got[0]).toEqual({ type: "replay_complete" });
  });
  test("T5 other sessionId unchanged", () => {
    const { got, wrapped } = registered();
    wrapped({ type: "error", sessionId: "w9:p9" });
    expect(got[0]).toEqual({ type: "error", sessionId: "w9:p9" });
  });
  test("T6 cockpit sink passes through", () => {
    const { sided, cockpit } = make();
    const sink = () => {};
    sided.registerClient("w1:p1", sink, "o");
    expect(cockpit.calls.registerClient[0][1]).toBe(sink);
  });
  test("T7 getClient routes", () => {
    const sink = () => {};
    const { sided, hangar } = make({}, { getClient: () => sink });
    expect(sided.getClient("fleet@w1:p1")).toBe(sink);
    expect(hangar.calls.getClient[0]).toEqual(["w1:p1"]);
  });
});

describe("KeyedCallsRouteBySide", () => {
  test("T1 hangar send", async () => {
    const { sided, cockpit, hangar } = make();
    await sided.send({ claudeUuid: "fleet@w1:p1", content: "hi" });
    expect(hangar.calls.send[0]).toEqual([{ claudeUuid: "w1:p1", content: "hi" }]);
    expect(cockpit.calls.send).toBeUndefined();
  });
  test("T2 cockpit send", async () => {
    const { sided, cockpit, hangar } = make();
    await sided.send({ claudeUuid: "w1:p1", content: "hi" });
    expect(cockpit.calls.send[0]).toEqual([{ claudeUuid: "w1:p1", content: "hi" }]);
    expect(hangar.calls.send).toBeUndefined();
  });
  test("T3 hangar unset sends verbatim to cockpit", async () => {
    const { sided, cockpit } = make({}, null);
    await sided.send({ claudeUuid: "fleet@w1:p1", content: "hi" });
    expect(cockpit.calls.send[0]).toEqual([{ claudeUuid: "fleet@w1:p1", content: "hi" }]);
  });
  test("T4 teardown result passes", async () => {
    const { sided, hangar } = make(
      {},
      { teardown: Promise.resolve({ killed: false, reason: "not_owned" }) },
    );
    expect(await sided.teardown("fleet@w1:p1")).toEqual({ killed: false, reason: "not_owned" });
    expect(hangar.calls.teardown[0]).toEqual(["w1:p1"]);
  });
  test("T5 readTranscriptPage", async () => {
    const { sided, hangar } = make();
    await sided.readTranscriptPage("fleet@w1:p1", null);
    expect(hangar.calls.readTranscriptPage[0]).toEqual(["w1:p1", null]);
  });
  test("T6 readCapabilities", async () => {
    const { sided, hangar } = make();
    await sided.readCapabilities("fleet@w1:p1");
    expect(hangar.calls.readCapabilities[0]).toEqual(["w1:p1", undefined]);
  });
  test("T7 paneCwd", async () => {
    const { sided, cockpit } = make({}, { paneCwd: Promise.resolve("/work/hangarproj") });
    expect(await sided.paneCwd("fleet@w1:p1")).toBe("/work/hangarproj");
    expect(cockpit.calls.paneCwd).toBeUndefined();
  });
  test("T8 hasSession re-prefixes paneRef", () => {
    const { sided } = make({}, { hasSession: { present: true, paneRef: "w1:p1" } });
    expect(sided.hasSession("fleet@w1:p1")).toEqual({ present: true, paneRef: "fleet@w1:p1" });
  });
  test("T9 createSession goes to cockpit unprefixed", async () => {
    const { sided, cockpit, hangar } = make();
    const r = await sided.createSession({ claudeUuid: "u1", cwd: "/r" });
    expect(cockpit.calls.createSession.length).toBe(1);
    expect(hangar.calls.createSession).toBeUndefined();
    expect(r.paneRef).toBe("w9:p1");
  });
  test("T9b a hangar create is routed to the hangar and prefixed", async () => {
    const { sided, cockpit, hangar } = make();
    const r = await sided.createSession({ claudeUuid: "u1", cwd: "/r", side: "hangar" });
    expect(r).toEqual({ name: "n", paneRef: "fleet@w9:p1" });
    expect(hangar.calls.createSession).toEqual([[{ claudeUuid: "u1", cwd: "/r" }]]);
    expect(cockpit.calls.createSession).toBeUndefined();
  });
  test("T9c a hangar create with no hangar configured rejects and calls nothing", async () => {
    const { sided, cockpit } = make({}, null);
    await expect(
      sided.createSession({ claudeUuid: "u1", cwd: "/r", side: "hangar" }),
    ).rejects.toThrow(/hangar/);
    expect(cockpit.calls.createSession).toBeUndefined();
  });
  test("T9d an offline hangar's rejection propagates and the cockpit is not tried", async () => {
    const { sided, cockpit } = make(
      {},
      { createSession: () => Promise.reject(new Error("connect ENOENT")) },
    );
    await expect(
      sided.createSession({ claudeUuid: "u1", cwd: "/r", side: "hangar" }),
    ).rejects.toThrow("connect ENOENT");
    expect(cockpit.calls.createSession).toBeUndefined();
  });
  test("T10 integrationStates cockpit only", async () => {
    const { sided, hangar } = make();
    expect(await sided.integrationStates()).toEqual({ claude: "current" });
    expect(hangar.calls.integrationStates).toBeUndefined();
  });
});

describe("ListingMarksOfflineSide", () => {
  test("T1 hangar offline", async () => {
    const { sided } = make(
      { listSessionsOutcome: Promise.resolve({ ok: true, sessions: [desc("w1:p1")] }) },
      { listSessionsOutcome: Promise.resolve({ ok: false, error: new Error("x") }) },
    );
    const r = await sided.listSessions();
    expect(r.herdr.hangar).toEqual({ name: "fleet", online: false });
    expect(r.herdr.cockpit.online).toBe(true);
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["w1:p1"]);
  });
  test("T2 cockpit offline, no hangar", async () => {
    const { sided } = make(
      { listSessionsOutcome: Promise.resolve({ ok: false, error: new Error("x") }) },
      null,
    );
    expect(await sided.listSessions()).toEqual({
      sessions: [],
      herdr: { cockpit: { online: false } },
    });
  });
  test("T3 incompatible watch short-circuits and warns once", async () => {
    const warns: string[] = [];
    const { sided, hangar } = make(
      {},
      { listSessionsOutcome: Promise.resolve({ ok: true, sessions: [desc("w1:p1")] }) },
      { warn: (m) => warns.push(m), hw: fakeWatch("incompatible").watch },
    );
    expect((await sided.listSessions()).herdr.hangar?.online).toBe(false);
    expect((await sided.listSessions()).herdr.hangar?.online).toBe(false);
    expect(hangar.calls.listSessionsOutcome).toBeUndefined();
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("fleet");
    expect(warns[0]).toContain("protocol");
  });
  test("T4 recovery without restart", async () => {
    let n = 0;
    const { sided } = make(
      {},
      {
        listSessionsOutcome: () =>
          Promise.resolve(
            ++n === 1
              ? { ok: false, error: new Error("x") }
              : { ok: true, sessions: [desc("w2:p1")] },
          ),
      },
    );
    expect((await sided.listSessions()).herdr.hangar?.online).toBe(false);
    const second = await sided.listSessions();
    expect(second.herdr.hangar?.online).toBe(true);
    expect(second.sessions.map((s) => s.sessionId)).toEqual(["fleet@w2:p1"]);
  });
  test("T5 throwing outcome is offline", async () => {
    const { sided } = make({ listSessionsOutcome: () => Promise.reject(new TypeError("bad")) });
    expect((await sided.listSessions()).herdr.cockpit.online).toBe(false);
  });
  test("T6 unreachable watch but ok outcome is online", async () => {
    const { sided } = make({}, {}, { hw: fakeWatch("unreachable").watch });
    expect((await sided.listSessions()).herdr.hangar?.online).toBe(true);
  });
});

describe("ListingMergesSides", () => {
  const ok = { listSessionsOutcome: Promise.resolve({ ok: true, sessions: [desc("w1:p1")] }) };
  test("T1 both sides, same bare id", async () => {
    const { sided } = make(ok, ok);
    const r = await sided.listSessions();
    expect(r.sessions.map((s) => [s.sessionId, s.side])).toEqual([
      ["w1:p1", "cockpit"],
      ["fleet@w1:p1", "hangar"],
    ]);
  });
  test("T2 other fields unchanged", async () => {
    const { sided } = make(
      {},
      {
        listSessionsOutcome: Promise.resolve({
          ok: true,
          sessions: [desc("w1:p1", { cwd: "/b", origin: "foreign" })],
        }),
      },
    );
    const h = (await sided.listSessions()).sessions[0];
    expect(h.workspaceId).toBe("w1");
    expect(h.cwd).toBe("/b");
    expect(h.origin).toBe("foreign");
  });
  test("T3 hangar unset", async () => {
    const { sided } = make(ok, null);
    const r = await sided.listSessions();
    expect(r.sessions.every((s) => s.side === "cockpit")).toBe(true);
    expect(r.herdr).toEqual({ cockpit: { online: true } });
    expect("hangar" in r.herdr).toBe(false);
  });
  test("T4 listStates prefixes hangar", async () => {
    const { sided } = make(
      { listStates: Promise.resolve({ "w1:p1": "running" }) },
      { listStates: Promise.resolve({ "w1:p1": "idle" }) },
    );
    expect(await sided.listStates()).toEqual({ "w1:p1": "running", "fleet@w1:p1": "idle" });
  });
});

describe("PermissionAnsweredByHoldingSide", () => {
  const held = (id: string, pane: string) => (r: string) => (r === id ? pane : undefined);
  test("T1 paneIdForRequest", () => {
    const { sided } = make(
      { paneIdForRequest: held("perm-a", "w1:p1") },
      { paneIdForRequest: held("perm-b", "w1:p1") },
    );
    expect(sided.paneIdForRequest("perm-a")).toBe("w1:p1");
    expect(sided.paneIdForRequest("perm-b")).toBe("fleet@w1:p1");
  });
  test("T2 resolve by holder", async () => {
    const { sided, cockpit, hangar } = make(
      { paneIdForRequest: held("perm-a", "w1:p1") },
      { paneIdForRequest: held("perm-b", "w1:p1") },
    );
    expect(await sided.resolvePermission("perm-b", { optionId: "2" })).toBe(true);
    expect(hangar.calls.resolvePermission).toEqual([["perm-b", { optionId: "2" }]]);
    expect(cockpit.calls.resolvePermission).toBeUndefined();
  });
  test("T3 unknown request", async () => {
    const { sided, cockpit, hangar } = make();
    expect(await sided.resolvePermission("perm-x", { allow: false })).toBe(false);
    expect(sided.paneIdForRequest("perm-x")).toBeUndefined();
    expect(sided.isPermissionCurrent("perm-x")).toBe(false);
    expect(sided.permissionAutoDenyMs("perm-x")).toBeUndefined();
    expect(cockpit.calls.resolvePermission).toBeUndefined();
    expect(hangar.calls.resolvePermission).toBeUndefined();
  });
  test("T4 current and autoDeny from holder", () => {
    const { sided } = make(
      {},
      {
        paneIdForRequest: held("perm-b", "w1:p1"),
        isPermissionCurrent: true,
        permissionAutoDenyMs: 42000,
      },
    );
    expect(sided.isPermissionCurrent("perm-b")).toBe(true);
    expect(sided.permissionAutoDenyMs("perm-b")).toBe(42000);
  });
});

describe("SidelessCallsReachBothSides", () => {
  test("T1 pausePermissions", () => {
    const { sided, cockpit, hangar } = make();
    sided.pausePermissions();
    expect(cockpit.calls.pausePermissions.length).toBe(1);
    expect(hangar.calls.pausePermissions.length).toBe(1);
  });
  test("T2 resumePermissions rejection does not stop the other", async () => {
    const { sided, cockpit } = make(
      {},
      { resumePermissions: () => Promise.reject(new Error("h")) },
    );
    await expect(sided.resumePermissions()).rejects.toThrow("h");
    expect(cockpit.calls.resumePermissions.length).toBe(1);
  });
  test("T3 cleanupByOwner", () => {
    const { sided, cockpit, hangar } = make();
    const o = {};
    sided.cleanupByOwner(o);
    expect(cockpit.calls.cleanupByOwner[0][0]).toBe(o);
    expect(hangar.calls.cleanupByOwner[0][0]).toBe(o);
  });
  test("T4 teardownAll stops watches", async () => {
    const cw = fakeWatch();
    const hw = fakeWatch();
    const { sided, cockpit, hangar } = make({}, {}, { cw: cw.watch, hw: hw.watch });
    await sided.teardownAll();
    expect(cockpit.calls.teardownAll.length).toBe(1);
    expect(hangar.calls.teardownAll.length).toBe(1);
    expect(cw.calls.stop).toBe(1);
    expect(hw.calls.stop).toBe(1);
  });
  test("T5 listLive", () => {
    const { sided } = make({ listLive: ["u1"] }, { listLive: ["w2:p1"] });
    expect(sided.listLive()).toEqual(["u1", "fleet@w2:p1"]);
  });
});

describe("SidesStartInBackground", () => {
  function setup() {
    const cw = fakeWatch();
    const hw = fakeWatch();
    const m = make({}, {}, { cw: cw.watch, hw: hw.watch });
    return { ...m, cw, hw };
  }
  test("T1 construction starts nothing", () => {
    const { hangar, cw, hw } = setup();
    expect(hangar.calls.start).toBeUndefined();
    expect(cw.calls.start + hw.calls.start).toBe(0);
  });
  test("T2 start", () => {
    const { sided, cockpit, hangar, cw, hw } = setup();
    sided.start();
    expect(hangar.calls.start.length).toBe(1);
    expect(cockpit.calls.start).toBeUndefined();
    expect(cw.calls.start).toBe(1);
    expect(hw.calls.start).toBe(1);
  });
  test("T3 idempotent", () => {
    const { sided, hangar, cw, hw } = setup();
    sided.start();
    sided.start();
    expect(hangar.calls.start.length).toBe(1);
    expect(cw.calls.start).toBe(1);
    expect(hw.calls.start).toBe(1);
  });
  test("T4 hangar unset", () => {
    const cw = fakeWatch();
    const { sided, cockpit } = make({}, null, { cw: cw.watch });
    sided.start();
    expect(cw.calls.start).toBe(1);
    expect(cockpit.calls.start).toBeUndefined();
  });
  test("T5 rejected hangar start is warned", async () => {
    const warns: string[] = [];
    const { sided } = make(
      {},
      { start: () => Promise.reject(new Error("boom")) },
      { warn: (m) => warns.push(m) },
    );
    expect(() => sided.start()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(warns.some((w) => /boom/.test(w))).toBe(true);
  });
});

describe("WsCannotNameHangar", () => {
  test("T5 handleTerminalCreate does not forward a side", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sided-create-"));
    const inputs: unknown[] = [];
    await handleTerminalCreate({ claudeUuid: "u1", cwd: dir, side: "hangar" } as never, {
      backend: {
        createSession: async (input) => {
          inputs.push(input);
          return { name: "n", paneRef: "p" };
        },
        teardown: async () => ({ killed: false }),
      },
      allowedRoots: null,
      send: () => {},
      agentProfiles: emptyAgentProfileSource(),
    });
    expect(inputs).toEqual([{ claudeUuid: "u1", cwd: dir }]);
  });
  test("T6 the wire schema drops a side", () => {
    const parsed = ClientMessage.parse({
      type: "terminal_create",
      claudeUuid: "u",
      cwd: "/tmp",
      side: "hangar",
    });
    expect("side" in parsed).toBe(false);
  });
});
