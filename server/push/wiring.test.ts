import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { parseServerConfig } from "../config";
import { createHerdrBackend } from "../herdr/backend";
import { createPushNotifier } from "./notifier";
import { createPushSender } from "./sender";
import { createSubscriptionStore } from "./subscription-store";

let tmp: string;
let storePath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wiring-"));
  storePath = join(tmp, "s.json");
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("PushNotifierWiring", () => {
  test("T1: createApp with pushStore + POST subscribe shares store with backend count", async () => {
    const store = createSubscriptionStore({ path: storePath });
    const backendRef = { current: null as any };
    const app = createApp(parseServerConfig([]), { pushStore: store, backendRef });
    const body = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "BN", auth: "k1" } };
    const res = await app.handle(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(201);
    expect(backendRef.current?.pushSubscriberCount?.()).toBe(1);
  });

  test("T2: herdr backend with push notifier calls onTurnSettled on idle after work", async () => {
    let emit: ((e: { event: string; data: unknown }) => void) | undefined;
    const client = {
      call: async () => ({ type: "ok" }),
      agentGet: async () => ({ agent_status: "idle" }),
      paneRead: async () => ({ text: "" }),
      paneSendText: async () => {},
      paneSendKeys: async () => {},
      subscribeEvents: async (o: { onEvent?: typeof emit }) => {
        emit = o.onEvent;
        return { stop() {} };
      },
    };
    const calls: string[] = [];
    const push = {
      onTurnSettled: (id: string) => {
        calls.push(id);
      },
    };
    const backend = createHerdrBackend({ client: client as any, push });
    backend.registerClient("%1", () => {});
    await backend.listSessionDescriptors();
    emit?.({ event: "pane_updated", data: { pane: { pane_id: "%1", agent_status: "working" } } });
    await Promise.resolve();
    emit?.({ event: "pane_updated", data: { pane: { pane_id: "%1", agent_status: "idle" } } });
    await Promise.resolve();
    expect(calls).toEqual(["%1"]);
  });

  test("T3: createHerdrBackend no push option succeeds, event handled", async () => {
    const fake = {
      call: async () => ({}),
      agentGet: async () => ({}),
      subscribeEvents: async () => ({ stop: () => {} }),
    } as any;
    expect(() => createHerdrBackend({ client: fake })).not.toThrow();
  });

  test("T4: backend construction when store file not exist succeeds", () => {
    const store = createSubscriptionStore({ path: join(tmp, "noexist.json") });
    const app = createApp(parseServerConfig([]), { pushStore: store });
    expect(app).toBeTruthy();
  });

  test("T5: a blocked pane reaches the push collaborator even when its screen cannot be parsed", async () => {
    // Push no longer waits for a card. This screen raises none (#33 leaves an
    // unparseable omp screen uncarded), and it still has to reach push: the
    // pane wants the human either way.
    const prompts: string[] = [];
    let emit: ((e: { event: string; data: unknown }) => void) | undefined;
    const backend = createHerdrBackend({
      client: {
        call: async () => ({ type: "ok" }),
        agentGet: async () => ({ agent_status: "blocked" }),
        paneRead: async () => ({ text: "unreadable screen", revision: 1 }),
        paneSendText: async () => {},
        paneSendKeys: async () => {},
        agentList: async () => [],
        sessionSnapshot: async () => ({ version: "0", protocol: 17, workspaces: [], panes: [] }),
        subscribeEvents: async (o: { onEvent?: (e: { event: string; data: unknown }) => void }) => {
          emit = o.onEvent;
          return { stop() {} };
        },
      } as any,
      push: {
        onAgentStatus: (paneId, status) => {
          if (status === "blocked") prompts.push(paneId);
        },
      },
    });
    await backend.listSessionDescriptors();
    emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: "%1", agent_status: "blocked", agent: "claude" } },
    });
    for (let i = 0; i < 20 && prompts.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // The pane id alone: the scope gate reads who spoke into it last, which is
    // a question the status carries nothing about.
    expect(prompts).toEqual(["%1"]);
    // Closes the status poll this backend armed; a test process is shared.
    await backend.teardownAll();
  });

  test("T6: the 3-tick push poll tier engages in a backend built with a subscriber count", async () => {
    // The tier was implemented and defaulted to "no subscribers" because
    // `hasPushSubscribers` was passed by nobody, so the real server stayed at
    // one snapshot per 30 ticks with a phone registered and none attached.
    let subscribers = 0;
    let snapshots = 0;
    const backend = createHerdrBackend({
      statusPollIntervalMs: 10,
      client: {
        call: async () => ({ type: "ok" }),
        agentGet: async () => ({ agent_status: "idle" }),
        paneRead: async () => ({ text: "" }),
        paneSendText: async () => {},
        paneSendKeys: async () => {},
        agentList: async () => [],
        sessionSnapshot: async () => {
          snapshots++;
          return { version: "0", protocol: 17, workspaces: [], panes: [], agents: [] };
        },
        subscribeEvents: async () => ({ stop() {} }),
      } as any,
      push: { subscriberCount: () => subscribers },
    });

    // No client attached, no subscriber: dormant (30 ticks = 300 ms here).
    await backend.listSessionDescriptors();
    const baseline = snapshots;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(snapshots - baseline).toBe(0);

    // A phone subscribes; the same poll now samples every 3rd tick.
    subscribers = 1;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(snapshots - baseline).toBeGreaterThan(0);
    await backend.teardownAll();
  });
});
