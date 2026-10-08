/**
 * The check that would have caught the whole round: drive push from the
 * assembled server.
 *
 * Every unit here passed against an injected collaborator while the assembled
 * server could not transmit a single push — no transport, no VAPID details, a
 * subscribe route that answered 201 and stored nothing, and a notifier nobody
 * had connected. So nothing between `createApp` and the transport boundary is
 * stubbed: the store, the route, the herdr backend, the pane-event pipeline,
 * the notifier and the sender are the production ones. The only stand-in is
 * `pushSend`, because the alternative is contacting Apple.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket as WsClient } from "ws";
import type { AppBackend } from "../app";
import { createApp } from "../app";
import { parseServerConfig } from "../config";
import { createPhoneDrivenTracker } from "./phone-driven";
import type { PushRequestOptions, PushSubscription } from "./sender";
import { createSubscriptionStore } from "./subscription-store";

const SELF_LABEL = "ccm-3f2a9b01-1111-4222-8333-444455556666";
const PANE = "w3V:p1";
const APPLE_ENDPOINT = "https://web.push.apple.com/abc";

type PaneEvent = { event: string; data: unknown };

/**
 * A herdr daemon that reports one pane cc-mobile launched (`ccm-` label →
 * `origin: "self"`), and hands back the hook the test uses to make that pane
 * finish a turn.
 */
function fakeHerdr() {
  const emitter: { emit?: (event: PaneEvent) => void } = {};
  const agent = {
    terminal_id: "t1",
    agent_status: "idle",
    workspace_id: "w3V",
    tab_id: "w3V:t1",
    pane_id: PANE,
    focused: false,
    revision: 4,
    agent: "claude",
    cwd: "/tmp/probe",
    agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: "sess-1" },
  };

  const client = {
    agentList: async () => [agent],
    agentGet: async () => agent,
    sessionSnapshot: async () => ({
      version: "0.7.5",
      protocol: 17,
      workspaces: [{ workspace_id: "w3V", label: SELF_LABEL }],
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
      emitter.emit = options.onEvent;
      return { stop() {} };
    },
  };

  return { client, emitter };
}

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.handle(
    new Request("http://localhost/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Waits for the fire-and-forget push path to reach the transport. */
async function until(condition: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

let tmp: string;
let envBackup: { pub?: string; priv?: string; subject?: string };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "assembled-push-"));
  envBackup = {
    pub: process.env.CC_MOBILE_VAPID_PUBLIC_KEY,
    priv: process.env.CC_MOBILE_VAPID_PRIVATE_KEY,
    subject: process.env.CC_MOBILE_VAPID_SUBJECT,
  };
  process.env.CC_MOBILE_VAPID_PUBLIC_KEY = "test-public-key";
  process.env.CC_MOBILE_VAPID_PRIVATE_KEY = "test-private-key";
  process.env.CC_MOBILE_VAPID_SUBJECT = "mailto:probe@example.com";
});

afterEach(() => {
  for (const [key, value] of [
    ["CC_MOBILE_VAPID_PUBLIC_KEY", envBackup.pub],
    ["CC_MOBILE_VAPID_PRIVATE_KEY", envBackup.priv],
    ["CC_MOBILE_VAPID_SUBJECT", envBackup.subject],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("the assembled server can actually transmit a push", () => {
  test("a settled turn reaches the transport with real VAPID details and leaves a real log line", async () => {
    const sends: Array<{ sub: PushSubscription; payload: string; opts: PushRequestOptions }> = [];
    const { client, emitter } = fakeHerdr();
    const logPath = join(tmp, "attempts.jsonl");
    const backendRef: { current: AppBackend | null } = { current: null };

    // The 45 s merge window, driven rather than waited out. Everything below
    // the notifier stays real; only the passage of time is injected.
    let fire: (() => void) | undefined;
    const app = createApp(parseServerConfig([]), {
      pushStore: createSubscriptionStore({ path: join(tmp, "subs.json") }),
      pushAttemptLogPath: logPath,
      herdrClient: client as never,
      backendRef,
      pushTimers: {
        setTimeoutFn: (fn) => {
          fire = fn;
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeoutFn: () => {
          fire = undefined;
        },
      },
      // The transport boundary, and nothing above it.
      pushSend: async (sub, payload, opts) => {
        sends.push({ sub, payload, opts });
        return { statusCode: 201 };
      },
    });

    // 1. The phone subscribes through the real HTTP route.
    expect(
      (await post(app, { endpoint: APPLE_ENDPOINT, keys: { p256dh: "BN", auth: "k1" } })).status,
    ).toBe(201);
    // 2. The route and the backend read one store (this is what "wiring" means).
    expect(backendRef.current?.pushSubscriberCount?.()).toBe(1);

    // 3. The phone sends a prompt into the pane, through the real backend. This
    //    is what puts the pane in scope under `phone-last`: the rule is "notify
    //    me about the work I asked for from here", and driving it any other way
    //    would test a pane nobody asked anything of.
    await backendRef.current?.listSessions?.();
    await backendRef.current?.send({ claudeUuid: PANE, content: "do the thing" });

    // 4. The pane runs that turn and settles.
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "working" } },
    });
    // `done` is end-of-turn: idle and not yet seen. `idle` alone never pushes.
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "done" } },
    });

    // Nothing goes out while the window is open.
    await until(() => fire !== undefined, "the merge window to be armed");
    expect(sends).toHaveLength(0);
    fire?.();

    await until(() => sends.length > 0, "the push to reach the transport");

    // 4. What actually went out.
    expect(sends).toHaveLength(1);
    expect(sends[0].sub.endpoint).toBe(APPLE_ENDPOINT);
    // The project is the basename of the cwd herdr reports for the pane
    // (`/tmp/probe`): one pane in the batch, so it is named.
    expect(JSON.parse(sends[0].payload)).toEqual({
      kind: "turn",
      title: "CCMobile",
      body: "A turn finished in probe",
      tag: "cc-mobile-push-turn",
    });
    expect(sends[0].opts.TTL).toBe(300);
    expect(sends[0].opts.urgency).toBe("normal");
    expect(sends[0].opts.vapidDetails).toEqual({
      subject: "mailto:probe@example.com",
      publicKey: "test-public-key",
      privateKey: "test-private-key",
    });

    // 5. The attempt log records the push service's own answer.
    await until(() => existsSync(logPath), "the attempt log");
    const line = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop() as string);
    expect(line).toMatchObject({
      kind: "turn",
      host: "web.push.apple.com",
      status: 201,
      reason: null,
    });
    expect(Number.isNaN(Date.parse(line.ts))).toBe(false);
    // Closes the 1 s status poll `listSessions` armed; one test
    // process is shared by every file in the suite.
    await backendRef.current?.teardownAll?.();
  });

  test("a permission prompt raised while the phone sleeps reaches the transport as a high-urgency push", async () => {
    // The turn trigger above was driven through the assembly; the permission
    // trigger was only ever pinned against `createHerdrBackend` directly, which
    // is the same blind spot that let a server ship transmitting nothing. So
    // this goes through `createApp` too: pane event → kind gate → screen read →
    // native permission → notifier → sender, all production.
    const sends: Array<{ payload: string; opts: PushRequestOptions }> = [];
    const { client, emitter } = fakeHerdr();
    const logPath = join(tmp, "attempts.jsonl");
    const backendRef: { current: AppBackend | null } = { current: null };

    const app = createApp(parseServerConfig([]), {
      pushStore: createSubscriptionStore({ path: join(tmp, "subs.json") }),
      pushAttemptLogPath: logPath,
      herdrClient: client as never,
      backendRef,
      pushSend: async (_sub, payload, opts) => {
        sends.push({ payload, opts });
        return { statusCode: 201 };
      },
    });

    expect(
      (await post(app, { endpoint: APPLE_ENDPOINT, keys: { p256dh: "BN", auth: "k1" } })).status,
    ).toBe(201);
    await backendRef.current?.listSessions?.();

    // The prompt the phone sent is what this permission question belongs to:
    // under `phone-last` a prompt is announced to whoever asked for the turn
    // that raised it.
    await backendRef.current?.send({ claudeUuid: PANE, content: "do the thing" });

    // claude asks for permission. The screen the
    // fake daemon returns parses to nothing, which is the unparseable fallback
    // — it still raises a request, and a request is what push announces.
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "blocked", agent: "claude" } },
    });

    const permissionSend = () =>
      sends.find((sent) => JSON.parse(sent.payload).kind === "permission");
    await until(() => permissionSend() !== undefined, "the permission push");

    const sent = permissionSend() as { payload: string; opts: PushRequestOptions };
    expect(JSON.parse(sent.payload)).toMatchObject({
      kind: "permission",
      body: "Permission needed in probe",
      tag: "cc-mobile-push-permission",
    });
    // A prompt is worth waking a phone for and is worthless once answered.
    expect(sent.opts.TTL).toBe(90);
    expect(sent.opts.urgency).toBe("high");
    expect(sent.opts.vapidDetails).toEqual({
      subject: "mailto:probe@example.com",
      publicKey: "test-public-key",
      privateKey: "test-private-key",
    });

    await until(() => existsSync(logPath), "the attempt log");
    expect(
      JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop() as string),
    ).toMatchObject({ kind: "permission", host: "web.push.apple.com", status: 201 });

    // Leaving `blocked` drops the pending request, and with it the 90 s
    // unattended-deny timer this pane armed — a real one, in a shared process.
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "idle", agent: "claude" } },
    });
    await backendRef.current?.teardownAll?.();
  });

  test("with no VAPID configured nothing is sent and nothing is logged as sent", async () => {
    delete process.env.CC_MOBILE_VAPID_PUBLIC_KEY;
    delete process.env.CC_MOBILE_VAPID_PRIVATE_KEY;
    let sent = 0;
    let fire: (() => void) | undefined;
    const { client, emitter } = fakeHerdr();
    const logPath = join(tmp, "attempts.jsonl");
    const backendRef: { current: AppBackend | null } = { current: null };

    const app = createApp(parseServerConfig([]), {
      pushStore: createSubscriptionStore({ path: join(tmp, "subs.json") }),
      pushAttemptLogPath: logPath,
      herdrClient: client as never,
      backendRef,
      pushTimers: {
        setTimeoutFn: (fn) => {
          fire = fn;
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeoutFn: () => {
          fire = undefined;
        },
      },
      pushSend: async () => {
        sent++;
        return { statusCode: 201 };
      },
    });

    await post(app, { endpoint: APPLE_ENDPOINT, keys: { p256dh: "BN", auth: "k1" } });
    await backendRef.current?.listSessions?.();
    // Drive the pane from the phone, or the scope gate is what stops the send
    // and this test proves nothing about VAPID.
    await backendRef.current?.send({ claudeUuid: PANE, content: "do the thing" });
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "working" } },
    });
    // `done`, not `idle`: `idle` can never push, so driving it would make this
    // pass for a reason that has nothing to do with what the test is named for.
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "done" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fire).not.toBeUndefined();
    fire?.();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sent).toBe(0);
    // The old else-branch wrote a 201 here — an unconfigured install was
    // indistinguishable from a working one.
    expect(existsSync(logPath)).toBe(false);
    // Closes the 1 s status poll `listSessions` armed; one test
    // process is shared by every file in the suite.
    await backendRef.current?.teardownAll?.();
  });

  test("the subscribe route refuses a host that only looks like Apple's", async () => {
    const store = createSubscriptionStore({ path: join(tmp, "subs.json") });
    const app = createApp(parseServerConfig([]), {
      pushStore: store,
      pushAttemptLogPath: join(tmp, "attempts.jsonl"),
      herdrClient: fakeHerdr().client as never,
    });

    const res = await post(app, {
      endpoint: "https://web.push.apple.com.evil.example/x",
      keys: { p256dh: "a", auth: "b" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "endpoint_not_allowed" });
    expect(store.count()).toBe(0);
  });

  test("tearing a pane down drops both its queued notification and its scope row", async () => {
    // Two rows survive every closed session otherwise, and a reused pane id
    // would inherit a verdict earned by whoever held that id before it.
    const forgotten: string[] = [];
    const tracker = createPhoneDrivenTracker();
    const realForget = tracker.forget.bind(tracker);
    tracker.forget = (paneId: string) => {
      forgotten.push(paneId);
      realForget(paneId);
    };
    let fire: (() => void) | undefined;
    const { client, emitter } = fakeHerdr();
    const backendRef: { current: AppBackend | null } = { current: null };

    const app = createApp(parseServerConfig([]), {
      pushStore: createSubscriptionStore({ path: join(tmp, "subs.json") }),
      pushAttemptLogPath: join(tmp, "attempts.jsonl"),
      herdrClient: client as never,
      backendRef,
      phoneDriven: tracker,
      pushTimers: {
        setTimeoutFn: (fn) => {
          fire = fn;
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeoutFn: () => {
          fire = undefined;
        },
      },
      pushSend: async () => ({ statusCode: 201 }),
    });

    await post(app, { endpoint: APPLE_ENDPOINT, keys: { p256dh: "BN", auth: "k1" } });
    await backendRef.current?.listSessions?.();
    await backendRef.current?.send({ claudeUuid: PANE, content: "do the thing" });
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "working" } },
    });
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "done" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fire).not.toBeUndefined();

    await backendRef.current?.teardown?.(PANE);

    expect(forgotten).toContain(PANE);
    expect(fire).toBeUndefined();
    expect(tracker.isPhoneDriven(PANE)).toBe(false);
    await backendRef.current?.teardownAll?.();
  });

  test("a pane the user started in their own terminal never buzzes the phone", async () => {
    let sent = 0;
    let fire: (() => void) | undefined;
    const { client, emitter } = fakeHerdr();
    // Same daemon, one difference: the workspace is not cc-mobile's.
    client.sessionSnapshot = async () => ({
      version: "0.7.5",
      protocol: 17,
      workspaces: [{ workspace_id: "w3V", label: "dev" }],
      panes: [],
      agents: [],
    });
    const backendRef: { current: AppBackend | null } = { current: null };

    const app = createApp(parseServerConfig([]), {
      pushStore: createSubscriptionStore({ path: join(tmp, "subs.json") }),
      pushAttemptLogPath: join(tmp, "attempts.jsonl"),
      herdrClient: client as never,
      backendRef,
      pushTimers: {
        setTimeoutFn: (fn) => {
          fire = fn;
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeoutFn: () => {
          fire = undefined;
        },
      },
      pushSend: async () => {
        sent++;
        return { statusCode: 201 };
      },
    });

    await post(app, { endpoint: APPLE_ENDPOINT, keys: { p256dh: "BN", auth: "k1" } });
    await backendRef.current?.listSessions?.();
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "working" } },
    });
    // `done`, not `idle`: `idle` can never push, so driving it would make this
    // pass for a reason that has nothing to do with what the test is named for.
    emitter.emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: PANE, agent_status: "done" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    fire?.();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sent).toBe(0);
    // Closes the 1 s status poll `listSessions` armed; one test
    // process is shared by every file in the suite.
    await backendRef.current?.teardownAll?.();
  });
});

/**
 * Foreground suppression, driven the way a phone drives it: a real WebSocket
 * carrying `?device=` and `visibility` frames into the listened app, and a
 * subscription posted with the same device name. `ws`'s client rather than the
 * global one, because happy-dom's announces `Origin: null`, which the root gate
 * refuses.
 */
describe("a phone that is looking at the app is not buzzed", () => {
  const DEVICE = "phone-a";

  async function rig(subscription: Record<string, unknown>) {
    const sends: string[] = [];
    const { client, emitter } = fakeHerdr();
    const logPath = join(tmp, "attempts.jsonl");
    const backendRef: { current: AppBackend | null } = { current: null };
    let fire: (() => void) | undefined;

    const app = createApp(parseServerConfig([]), {
      pushStore: createSubscriptionStore({ path: join(tmp, "subs.json") }),
      pushAttemptLogPath: logPath,
      herdrClient: client as never,
      backendRef,
      gateEnv: {},
      pushTimers: {
        setTimeoutFn: (fn) => {
          fire = fn;
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeoutFn: () => {
          fire = undefined;
        },
      },
      pushSend: async (_sub, payload) => {
        sends.push(JSON.parse(payload).kind);
        return { statusCode: 201 };
      },
    });
    expect((await post(app, subscription)).status).toBe(201);

    const server = app.listen(0).server as { port: number; stop(force?: boolean): void };
    const socket = new WsClient(
      `ws://127.0.0.1:${server.port}/ws?device=${encodeURIComponent(DEVICE)}`,
    );
    const frames: string[] = [];
    socket.onmessage = (event) => frames.push(JSON.parse(String(event.data)).type);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("the phone could not connect"));
    });

    await backendRef.current?.listSessions?.();
    await backendRef.current?.send({ claudeUuid: PANE, content: "do the thing" });

    const lines = () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [];

    return {
      sends,
      lines,
      fire: () => fire?.(),
      armed: () => fire !== undefined,
      /** `visibility` has no reply; the next request's reply is its receipt. */
      async report(state: "visible" | "hidden") {
        const before = frames.filter((type) => type === "server_config").length;
        socket.send(JSON.stringify({ type: "visibility", state }));
        socket.send(JSON.stringify({ type: "get_server_config" }));
        await until(
          () => frames.filter((type) => type === "server_config").length > before,
          "the visibility report to land",
        );
      },
      status(agent_status: string) {
        emitter.emit?.({
          event: "pane_updated",
          data: { pane: { pane_id: PANE, agent_status, agent: "claude" } },
        });
      },
      async stop() {
        socket.close();
        await backendRef.current?.teardownAll?.();
        server.stop(true);
      },
    };
  }

  const SUB = { endpoint: APPLE_ENDPOINT, keys: { p256dh: "BN", auth: "k1" } };

  test("a turn whose phone is looking at expiry is skipped, logged as a skip, and never re-sent", async () => {
    const h = await rig({ ...SUB, device: DEVICE });
    await h.report("visible");
    h.status("working");
    h.status("done");
    await until(h.armed, "the merge window to be armed");
    h.fire();
    await until(() => h.lines().length > 0, "the skip line");

    expect(h.sends).toEqual([]);
    expect(h.lines()).toEqual([
      {
        ts: expect.any(String),
        kind: "turn",
        host: "web.push.apple.com",
        status: null,
        reason: "foreground",
        skipped: true,
      },
    ]);

    // Putting the phone down afterwards brings nothing back.
    await h.report("hidden");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.armed()).toBe(false);
    expect(h.sends).toEqual([]);
    expect(h.lines()).toHaveLength(1);
    await h.stop();
  });

  test("foreground is read at expiry: picked up inside the window, the turn is skipped", async () => {
    const h = await rig({ ...SUB, device: DEVICE });
    await h.report("hidden");
    h.status("working");
    h.status("done");
    await until(h.armed, "the merge window to be armed");
    await h.report("visible");
    h.fire();
    await until(() => h.lines().length > 0, "the skip line");

    expect(h.sends).toEqual([]);
    expect(h.lines()[0]).toMatchObject({ kind: "turn", skipped: true });
    await h.stop();
  });

  test("foreground is read at expiry: put down inside the window, the turn is sent", async () => {
    const h = await rig({ ...SUB, device: DEVICE });
    await h.report("visible");
    h.status("working");
    h.status("done");
    await until(h.armed, "the merge window to be armed");
    await h.report("hidden");
    h.fire();
    await until(() => h.sends.length > 0, "the turn push");

    expect(h.sends).toEqual(["turn"]);
    expect(h.lines()[0]).toMatchObject({ kind: "turn", status: 201, reason: null });
    expect("skipped" in h.lines()[0]).toBe(false);
    await h.stop();
  });

  test("a blocked pane is skipped at once while its phone is looking", async () => {
    const h = await rig({ ...SUB, device: DEVICE });
    await h.report("visible");
    h.status("blocked");
    await until(() => h.lines().length > 0, "the skip line");

    expect(h.sends).toEqual([]);
    expect(h.lines()[0]).toMatchObject({
      kind: "permission",
      status: null,
      reason: "foreground",
      skipped: true,
    });
    // Leaving `blocked` drops the pending request and its 90 s deny timer.
    h.status("idle");
    await h.stop();
  });

  test("a subscription registered without a device is sent to even while a phone is looking", async () => {
    const h = await rig(SUB);
    await h.report("visible");
    h.status("working");
    h.status("done");
    await until(h.armed, "the merge window to be armed");
    h.fire();
    await until(() => h.sends.length > 0, "the turn push");

    expect(h.sends).toEqual(["turn"]);
    await h.stop();
  });
});
