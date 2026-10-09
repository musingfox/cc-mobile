/**
 * The assembled server over two fake daemons (ADR-018): `createApp` composes a
 * cockpit and a hangar backend, and everything between it and the herdr client
 * and push transport is the production article. Hermetic: fakes only, an
 * ephemeral port, tmpdir files.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket as WsClient } from "ws";
import type { AgentProfileSource } from "../agents/profiles";
import { type AppBackend, createApp } from "../app";
import { HerdrTransportError } from "../herdr/errors";
import { composeLaunchPrompt } from "../launch-prompt";
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
  payload?: {
    type?: string;
    requestId?: string;
    sessionId?: string;
    state?: string;
    autoDenyMs?: number;
  };
  sessions?: Array<{ sessionId: string; side?: string }>;
  herdr?: { cockpit: { online: boolean }; hangar?: { name: string; online: boolean } };
};

/** One fake herdr daemon with a single pane, plus the counters tests assert on. */
function fakeDaemon(cwd: string) {
  const emitter: { emit?: (event: PaneEvent) => void } = {};
  const counts = { subscribe: 0, assertCompatible: 0, agentList: 0 };
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const typed: Array<{ pane: string; text?: string; keys?: string[] }> = [];
  let shellOnly = false;
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
    agentGet: async () => ({ ...agent, interactive_ready: true }),
    sessionSnapshot: async () => ({
      version: "0.7.5",
      protocol: 22,
      workspaces: [{ workspace_id: "w3V", label: LABEL }],
      panes: [],
      agents: [],
    }),
    paneRead: async () => ({ text: "", revision: 1 }),
    paneSendText: async (pane: string, text: string) => void typed.push({ pane, text }),
    paneSendKeys: async (pane: string, keys: string[]) => void typed.push({ pane, keys }),
    call: async (method: string, params: unknown) => {
      calls.push({ method, params: params as Record<string, unknown> });
      if (method === "workspace.create") {
        shellOnly = true;
        return {
          type: "workspace_created",
          workspace: { workspace_id: "w3V" },
          root_pane: { pane_id: PANE },
        };
      }
      if (method === "agent.start") {
        shellOnly = false;
        return { type: "agent_started" };
      }
      const process_info = shellOnly
        ? {
            pane_id: PANE,
            shell_pid: 4100,
            foreground_process_group_id: 4100,
            foreground_processes: [{ pid: 4100, name: "zsh" }],
          }
        : {
            pane_id: (params as { pane_id: string }).pane_id,
            foreground_processes: [{ pid: 1, argv0: "claude", argv: ["claude"] }],
          };
      return { type: "pane_process_info", process_info };
    },
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
  return { client, emitter, counts, behaviour, status, calls, typed };
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
  vaultRoot?: string;
  launchToken?: string;
  launchesDir?: string;
  agentProfiles?: AgentProfileSource;
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
    {
      ...testServerConfig,
      hangarSession: options.hangarSession,
      ...(options.launchToken ? { launchToken: options.launchToken } : {}),
      ...(options.vaultRoot ? { vaultRoot: options.vaultRoot } : {}),
    },
    {
      ...(options.launchesDir ? { launchesDir: options.launchesDir } : {}),
      cardWorktrees: { create: async () => ({ kind: "not_a_repo" }), remove: async () => {} },
      ...(options.agentProfiles ? { agentProfiles: options.agentProfiles } : {}),
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
  const launch = (body: unknown) =>
    app.handle(
      new Request("http://localhost/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer tok" },
        body: JSON.stringify(body),
      }),
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
    // Bound where the phone dials: a wildcard bind can be handed a port another
    // process already holds on 127.0.0.1, and the dial then reaches that process.
    const server = app.listen({ port: 0, hostname: "127.0.0.1" }).server as {
      port: number;
      stop(force?: boolean): void;
    };
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
    launch,
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

describe("HangarCallbacksCarryPrefixedKey", () => {
  test("T1: a hangar pane blocking pushes with the hangar project, with no phone send", async () => {
    const r = rig({ hangarSession: "fleet" });
    await r.subscribe();
    r.backendRef.current?.start?.();
    await until(() => r.hangar.counts.subscribe === 1, "the hangar subscription");
    r.hangar.status("working");
    r.hangar.status("blocked");

    await until(() => r.sends.length > 0, "the permission push");
    expect(r.sends).toHaveLength(1);
    expect(r.sends[0].payload.body).toBe("Permission needed in hangarproj");
  });

  test("T2: a cockpit pane blocking without a phone send stays silent", async () => {
    const r = rig({ hangarSession: "fleet" });
    await r.subscribe();
    r.backendRef.current?.start?.();
    await r.backendRef.current?.listSessions?.();
    r.cockpit.status("working");
    r.cockpit.status("blocked");
    await Bun.sleep(100);

    expect(r.sends).toHaveLength(0);
  });

  test("T3: a hangar turn finishing pushes the hangar project when the window fires", async () => {
    const r = rig({ hangarSession: "fleet" });
    await r.subscribe();
    r.backendRef.current?.start?.();
    await until(() => r.hangar.counts.subscribe === 1, "the hangar subscription");
    r.hangar.status("working");
    r.hangar.status("done");
    await until(() => r.handle.fire !== undefined, "the turn window");
    r.handle.fire?.();

    await until(() => r.sends.length > 0, "the turn push");
    expect(r.sends[0].payload.body).toBe("A turn finished in hangarproj");
  });

  test("T4: answering a hangar card audits the prefixed pane key", async () => {
    const r = rig({ hangarSession: "fleet" });
    const phone = await r.phone();
    await phone.list();
    r.hangar.status("blocked");
    const card = await phone.waitFor(
      (f) => f.payload?.type === "permission_request",
      "the hangar card",
    );
    phone.socket.send(
      JSON.stringify({
        type: "permission",
        requestId: card.payload?.requestId,
        optionId: "cancel",
      }),
    );

    // Only newline-terminated lines: the file exists empty before its first
    // append lands, and a line still being appended can be read half-written.
    const lines = () =>
      existsSync(r.paths.auditLogPath)
        ? readFileSync(r.paths.auditLogPath, "utf8")
            .split("\n")
            .slice(0, -1)
            .map((line) => JSON.parse(line))
        : [];
    // The keys line is written while the answer is still being resolved, and
    // the answer line only after, so waiting on the keys line alone races it.
    await until(
      () =>
        ["permission_answer", "permission_keys_send"].every((action) =>
          lines().some((l) => l.action === action),
        ),
      "both audit lines",
    );
    expect(lines()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "permission_answer", paneId: HANGAR_KEY }),
        expect.objectContaining({ action: "permission_keys_send", paneId: HANGAR_KEY }),
      ]),
    );
  });
});

describe("HangarBackendDenyOff", () => {
  test("T1: a hangar card carries no autoDenyMs", async () => {
    const r = rig({ hangarSession: "fleet" });
    const phone = await r.phone();
    await phone.list();
    r.hangar.status("blocked");
    const card = await phone.waitFor(
      (f) => f.payload?.type === "permission_request" && f.payload.sessionId === HANGAR_KEY,
      "the hangar card",
    );
    expect("autoDenyMs" in (card.payload ?? {})).toBe(false);
  });

  test("T2: a cockpit card still carries the 90 s countdown", async () => {
    const r = rig({ hangarSession: "fleet" });
    const phone = await r.phone();
    await phone.list();
    r.cockpit.status("blocked");
    const card = await phone.waitFor(
      (f) => f.payload?.type === "permission_request" && f.payload.sessionId === PANE,
      "the cockpit card",
    );
    expect(typeof card.payload?.autoDenyMs).toBe("number");
    expect(card.payload?.autoDenyMs).toBeGreaterThan(0);
    expect(card.payload?.autoDenyMs).toBeLessThanOrEqual(90_000);
    // Answered and awaited so the armed timer and the key send finish inside the test.
    phone.socket.send(
      JSON.stringify({
        type: "permission",
        requestId: card.payload?.requestId,
        optionId: "cancel",
      }),
    );
    await until(
      () =>
        existsSync(r.paths.auditLogPath) &&
        // Only newline-terminated lines, for the same reason as T4's reader.
        readFileSync(r.paths.auditLogPath, "utf8")
          .split("\n")
          .slice(0, -1)
          .some((line) => {
            const l = JSON.parse(line);
            return l.action === "permission_keys_send" && l.paneId === PANE;
          }),
      "the cockpit keys audit line",
    );
  });
});

describe("HangarOfflinePushReachesTransport", () => {
  async function runTo(r: ReturnType<typeof rig>, from: number, to: number) {
    for (let t = from; t <= to; t += 10_000) await r.clock.tick(t);
  }

  test("T1: one Hangar offline push at 300 s, none earlier, none repeated", async () => {
    const r = rig({ hangarSession: "fleet" });
    r.hangar.behaviour.compatibleFails = true;
    await r.subscribe();
    r.backendRef.current?.start?.();
    await flush();

    await runTo(r, 10_000, 290_000);
    expect(r.sends).toHaveLength(0);
    await r.clock.tick(300_000);
    await until(() => r.sends.length === 1, "the offline push");
    expect(r.sends[0].payload).toEqual({
      kind: "hangar_offline",
      title: "CCMobile",
      body: "Hangar offline",
      tag: "cc-mobile-push-hangar-offline",
    });
    expect(r.sends[0].opts).toMatchObject({ TTL: 90, urgency: "high" });
    await until(() => existsSync(r.paths.pushAttemptLogPath), "the attempt log");
    const line = JSON.parse(
      readFileSync(r.paths.pushAttemptLogPath, "utf8").trim().split("\n").pop() as string,
    );
    expect(line.kind).toBe("hangar_offline");

    await runTo(r, 310_000, 900_000);
    expect(r.sends).toHaveLength(1);
  });

  test("T2: recovery sends nothing more", async () => {
    const r = rig({ hangarSession: "fleet" });
    r.hangar.behaviour.compatibleFails = true;
    await r.subscribe();
    r.backendRef.current?.start?.();
    await flush();

    await runTo(r, 10_000, 300_000);
    await until(() => r.sends.length === 1, "the offline push");
    r.hangar.behaviour.compatibleFails = false;
    await runTo(r, 310_000, 900_000);

    expect(r.sends).toHaveLength(1);
  });

  test("T3: a cockpit that stays unreachable never pushes", async () => {
    const r = rig({ hangarSession: null });
    r.cockpit.behaviour.compatibleFails = true;
    await r.subscribe();
    r.backendRef.current?.start?.();
    await flush();

    await runTo(r, 10_000, 900_000);

    expect(r.cockpit.counts.assertCompatible).toBeGreaterThan(1);
    expect(r.sends).toHaveLength(0);
  });
});

describe("HangarWatchedFromBoot", () => {
  test("T1: start() alone opens the hangar subscription and a first blocked report pushes", async () => {
    const r = rig({ hangarSession: "fleet" });
    await r.subscribe();
    r.backendRef.current?.start?.();
    await until(() => r.hangar.counts.subscribe === 1, "the hangar subscription");

    expect(r.hangar.counts.agentList).toBe(0);
    r.hangar.status("blocked");
    await until(() => r.sends.length > 0, "the permission push");
    expect(r.sends[0].payload.body).toBe("Permission needed in hangarproj");
  });

  test("T2: a first report of done arms no turn window", async () => {
    const r = rig({ hangarSession: "fleet" });
    await r.subscribe();
    r.backendRef.current?.start?.();
    await until(() => r.hangar.counts.subscribe === 1, "the hangar subscription");
    r.hangar.status("done");
    await Bun.sleep(100);

    expect(r.handle.fire).toBeUndefined();
    expect(r.sends).toHaveLength(0);
  });
});

describe("AssembledLaunchOnHangarDaemon", () => {
  const CARD = "# Task\nCARD-BODY do the thing\n";
  const body = {
    cwd: "/tmp",
    cardPath: "pm/cc-mobile/tasks/card.md",
    vault: "obsidian",
    project: "cc-mobile",
    profileId: "claude-auto",
  };
  const claudeAuto = {
    id: "claude-auto",
    label: "auto",
    kind: "claude" as const,
    args: ["--permission-mode", "auto"],
  };

  function launchRig(hangarSession: string | null) {
    const vault = join(tmp, "obsidian");
    mkdirSync(join(vault, "pm", "cc-mobile", "tasks"), { recursive: true });
    writeFileSync(join(vault, body.cardPath), CARD);
    const r = rig({
      hangarSession,
      vaultRoot: vault,
      launchToken: "tok",
      launchesDir: join(tmp, "launches"),
      agentProfiles: { list: () => [claudeAuto] },
    });
    // A claude that takes the Enter starts its turn; the launch waits to see it.
    const sendKeys = r.hangar.client.paneSendKeys;
    r.hangar.client.paneSendKeys = async (pane, keys) => {
      await sendKeys(pane, keys);
      if (keys.includes("Enter")) r.hangar.status("working");
    };
    return r;
  }
  const methods = (d: ReturnType<typeof fakeDaemon>) => d.calls.map((c) => c.method);

  test("T1: the pane is created and started on the hangar daemon only", async () => {
    const r = launchRig("fleet");
    const res = await r.launch(body);
    expect(res.status).toBe(201);
    const { sessionId, claudeUuid } = await res.json();
    expect(sessionId).toBe(HANGAR_KEY);
    const create = r.hangar.calls.find((c) => c.method === "workspace.create");
    expect(create?.params.label).toBe(`ccm-${claudeUuid}`);
    const start = r.hangar.calls.find((c) => c.method === "agent.start");
    expect(start?.params.args).toEqual(["--session-id", claudeUuid, "--permission-mode", "auto"]);
    expect(methods(r.cockpit)).not.toContain("workspace.create");
    expect(methods(r.cockpit)).not.toContain("agent.start");
  });

  test("T2: the template and card are typed into the hangar pane, then Enter", async () => {
    const r = launchRig("fleet");
    await r.launch(body);
    expect(r.hangar.typed).toEqual([
      { pane: PANE, text: composeLaunchPrompt(CARD) },
      { pane: PANE, keys: ["Enter"] },
    ]);
    expect(r.cockpit.typed).toEqual([]);
  });

  test("T3: the binding names the hangar key", async () => {
    const r = launchRig("fleet");
    const { claudeUuid } = await (await r.launch(body)).json();
    const file = join(tmp, "launches", `${claudeUuid}.json`);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).paneId).toBe(HANGAR_KEY);
  });

  test("T4: with no hangar session the launch is refused and neither daemon creates", async () => {
    const r = launchRig(null);
    const res = await r.launch(body);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "hangar_unavailable" });
    expect(methods(r.cockpit)).not.toContain("workspace.create");
    expect(methods(r.hangar)).not.toContain("workspace.create");
  });
});
