/**
 * The assembled server over two fake daemons (ADR-018): `createApp` composes a
 * cockpit and a hangar backend, and everything between it and the herdr client
 * and push transport is the production article. Hermetic: fakes only, an
 * ephemeral port, tmpdir files.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket as WsClient } from "ws";
import { type AppBackend, createApp } from "../app";
import { HerdrTransportError } from "../herdr/errors";
import { createSubscriptionStore } from "../push/subscription-store";
import { testServerConfig } from "./ws-harness";

const PANE = "w3V:p1";
const LABEL = "ccm-3f2a9b01-1111-4222-8333-444455556666";
const APPLE_ENDPOINT = "https://web.push.apple.com/abc";
const HANGAR_KEY = `fleet@${PANE}`;

type PaneEvent = { event: string; data: unknown };

type Frame = {
  type: string;
  sessionId?: string;
  payload?: { type?: string; requestId?: string; sessionId?: string; state?: string };
  sessions?: Array<{ sessionId: string; side?: string }>;
  herdr?: { cockpit: { online: boolean }; hangar?: { name: string; online: boolean } };
};

/** One fake herdr daemon with a single pane, plus the counters tests assert on. */
function fakeDaemon(cwd: string) {
  const emitter: { emit?: (event: PaneEvent) => void } = {};
  const counts = { subscribe: 0, assertCompatible: 0, agentList: 0 };
  const behaviour = { listFails: false, compatibleFails: false };
  const agent = {
    terminal_id: "t1",
    agent_status: "idle",
    workspace_id: "w3V",
    tab_id: "w3V:t1",
    pane_id: PANE,
    focused: false,
    revision: 4,
    agent: "claude",
    cwd,
    agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: "sess-1" },
  };
  const client = {
    assertCompatible: async () => {
      counts.assertCompatible++;
      if (behaviour.compatibleFails) throw new HerdrTransportError("connect ENOENT");
      return { protocol: 22 };
    },
    agentList: async () => {
      counts.agentList++;
      if (behaviour.listFails) throw new HerdrTransportError("connect ENOENT");
      return [agent];
    },
    agentGet: async () => agent,
    sessionSnapshot: async () => ({
      version: "0.7.5",
      protocol: 22,
      workspaces: [{ workspace_id: "w3V", label: LABEL }],
      panes: [],
      agents: [],
    }),
    paneRead: async () => ({ text: "", revision: 1 }),
    paneSendText: async () => {},
    paneSendKeys: async () => {},
    call: async (_method: string, params: unknown) => ({
      type: "pane_process_info",
      process_info: {
        pane_id: (params as { pane_id: string }).pane_id,
        foreground_processes: [{ pid: 1, argv0: "claude", argv: ["claude"] }],
      },
    }),
    subscribeEvents: async (options: { onEvent?: (event: PaneEvent) => void }) => {
      counts.subscribe++;
      emitter.emit = options.onEvent;
      return { stop() {} };
    },
  };
  const status = (agent_status: string) => {
    agent.agent_status = agent_status;
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status, agent: "claude" } },
    });
  };
  return { client, emitter, counts, behaviour, status };
}

let tmp: string;
let envBackup: Record<string, string | undefined>;
const VAPID = {
  CC_MOBILE_VAPID_PUBLIC_KEY: "test-public-key",
  CC_MOBILE_VAPID_PRIVATE_KEY: "test-private-key",
  CC_MOBILE_VAPID_SUBJECT: "mailto:probe@example.com",
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "hangar-assembled-"));
  envBackup = Object.fromEntries(Object.keys(VAPID).map((k) => [k, process.env[k]]));
  Object.assign(process.env, VAPID);
});

afterEach(() => {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tmp, { recursive: true, force: true });
});

async function until(condition: () => boolean, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await Bun.sleep(5);
  }
  if (condition()) return;
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

const flush = () => Bun.sleep(0);

/** The watch interval, driven by hand: `tick(ms)` moves the clock and runs one probe. */
function manualClock() {
  let now = 0;
  let run: (() => void) | undefined;
  return {
    timers: {
      now: () => now,
      setIntervalFn: (fn: () => void) => {
        run = fn;
        return 1;
      },
      clearIntervalFn: () => {
        run = undefined;
      },
    },
    async tick(to: number) {
      now = to;
      run?.();
      for (let i = 0; i < 5; i++) await flush();
    },
  };
}

function rig(options: {
  hangarSession: string | null;
  cockpit?: ReturnType<typeof fakeDaemon>;
  hangar?: ReturnType<typeof fakeDaemon>;
  clock?: ReturnType<typeof manualClock>;
}) {
  const cockpit = options.cockpit ?? fakeDaemon("/tmp/cockpitproj");
  const hangar = options.hangar ?? fakeDaemon("/tmp/hangarproj");
  const clock = options.clock ?? manualClock();
  const sends: Array<{ payload: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  const backendRef: { current: AppBackend | null } = { current: null };
  const handle: { fire?: () => void } = {};
  const paths = {
    auditLogPath: join(tmp, "audit.jsonl"),
    pushAttemptLogPath: join(tmp, "attempts.jsonl"),
  };
  const app = createApp(
    { ...testServerConfig, hangarSession: options.hangarSession },
    {
      pushStore: createSubscriptionStore({ path: join(tmp, "subs.json") }),
      ...paths,
      herdrClient: cockpit.client as never,
      hangarHerdrClient: hangar.client as never,
      socketWatchTimers: clock.timers,
      backendRef,
      gateEnv: {},
      pushTimers: {
        setTimeoutFn: (fn) => {
          handle.fire = fn;
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeoutFn: () => {
          handle.fire = undefined;
        },
      },
      pushSend: async (_sub, payload, opts) => {
        sends.push({ payload: JSON.parse(payload), opts: opts as never });
        return { statusCode: 201 };
      },
    },
  );
  const subscribe = () =>
    app.handle(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: APPLE_ENDPOINT, keys: { p256dh: "BN", auth: "k1" } }),
      }),
    );

  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
    await backendRef.current?.teardownAll?.();
  });

  async function phone() {
    const server = app.listen(0).server as { port: number; stop(force?: boolean): void };
    const socket = new WsClient(`ws://127.0.0.1:${server.port}/ws?device=phone-a`);
    const frames: Frame[] = [];
    socket.onmessage = (event) => frames.push(JSON.parse(String(event.data)));
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("the phone could not connect"));
    });
    cleanups.push(() => {
      socket.close();
      server.stop(true);
    });
    const waitFor = async (match: (f: Frame) => boolean, label: string) => {
      await until(() => frames.some(match), label);
      return frames.find(match) as Frame;
    };
    const list = async () => {
      const before = frames.filter((f) => f.type === "terminal_sessions").length;
      socket.send(JSON.stringify({ type: "list_terminal_sessions" }));
      await until(
        () => frames.filter((f) => f.type === "terminal_sessions").length > before,
        "terminal_sessions",
      );
      return frames.filter((f) => f.type === "terminal_sessions")[before];
    };
    return { socket, frames, waitFor, list };
  }

  return {
    app,
    cockpit,
    hangar,
    clock,
    sends,
    backendRef,
    handle,
    paths,
    subscribe,
    phone,
  };
}

describe("AppServesBothSockets", () => {
  test("T1: one listing carries both daemons' panes, sides and status", async () => {
    const r = rig({ hangarSession: "fleet" });
    const phone = await r.phone();
    const reply = await phone.list();

    expect(reply.sessions?.map((s) => s.sessionId)).toEqual([PANE, HANGAR_KEY]);
    expect(reply.sessions?.map((s) => s.side)).toEqual(["cockpit", "hangar"]);
    expect(reply.herdr).toEqual({
      cockpit: { online: true },
      hangar: { name: "fleet", online: true },
    });
  });

  test("T2: a hangar status event reaches the phone under the prefixed key only", async () => {
    const r = rig({ hangarSession: "fleet" });
    const phone = await r.phone();
    await phone.list();
    r.hangar.emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "working" } },
    });

    const frame = await phone.waitFor(
      (f) => f.type === "event" && f.payload?.type === "session_state",
      "the hangar session_state",
    );
    expect(frame).toMatchObject({
      type: "event",
      sessionId: HANGAR_KEY,
      payload: { type: "session_state", sessionId: HANGAR_KEY, state: "running" },
    });
    await flush();
    expect(
      phone.frames.some((f) => f.payload?.type === "session_state" && f.payload.sessionId === PANE),
    ).toBe(false);
  });

  test("T3: an unreachable hangar is offline and the cockpit is still listed", async () => {
    const r = rig({ hangarSession: "fleet" });
    r.hangar.behaviour.listFails = true;
    const phone = await r.phone();
    const reply = await phone.list();

    expect(reply.herdr?.hangar?.online).toBe(false);
    expect(reply.sessions?.map((s) => s.sessionId)).toEqual([PANE]);
  });

  test("T4: with no hangar session the composite is the cockpit alone", async () => {
    const r = rig({ hangarSession: null });
    const phone = await r.phone();
    const reply = await phone.list();

    expect(reply.herdr).toEqual({ cockpit: { online: true } });
    expect(reply.sessions?.map((s) => s.side)).toEqual(["cockpit"]);
    expect(reply.sessions?.[0].sessionId).toBe(PANE);
  });

  test("T5: constructing the app contacts neither daemon", () => {
    const r = rig({ hangarSession: "fleet" });
    for (const daemon of [r.cockpit, r.hangar]) {
      expect(daemon.counts.subscribe).toBe(0);
      expect(daemon.counts.assertCompatible).toBe(0);
    }
  });
});
