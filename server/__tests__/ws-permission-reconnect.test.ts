/**
 * ws-permission-reconnect.test.ts — PermissionSurvivesReconnect.
 *
 * A phone loses its socket while a prompt is waiting, comes back on a new one,
 * and answers. Everything between the socket and the herdr client is the
 * production assembly from `createApp` — the WS plugin, the backend, the pane
 * event pipeline, the native permission module and its fire-time guard — so the
 * only stand-in is the daemon itself. A stubbed backend would prove the message
 * reaches a method, not that the key reaches the pane.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { emptyAgentProfileSource } from "../agents/profiles";
import { type AppBackend, createApp } from "../app";
import { EventBuffer } from "../event-buffer";
import { createSubscriptionStore } from "../push/subscription-store";
import { testServerConfig } from "./ws-harness";

const BASH_PROMPT = readFileSync(
  join(import.meta.dir, "..", "herdr", "permission", "fixtures", "blocked-bash-prompt.txt"),
  "utf8",
);
const PANE = "w9R:p1";

type PaneEvent = { event: string; data: unknown };
type Frame = Record<string, unknown>;

/**
 * A daemon with one claude pane, by default in a workspace the user opened
 * themselves. The default label is deliberately not `ccm-`: a self-launched pane
 * arms the 90 s deny, whose timer only the countdown tests have reason to own,
 * and the answer path is the same.
 */
function fakeHerdr(workspaceLabel = "user-terminal") {
  const status = { value: "idle" };
  const keys: { pane: string; keys: string[] }[] = [];
  const emitter: { emit?: (event: PaneEvent) => void } = {};
  const agent = () => ({
    terminal_id: "t1",
    agent_status: status.value,
    workspace_id: "w9R",
    tab_id: "w9R:t1",
    pane_id: PANE,
    focused: false,
    revision: 1,
    agent: "claude",
    cwd: "/tmp/probe",
  });

  const client = {
    agentList: async () => [agent()],
    agentGet: async () => agent(),
    sessionSnapshot: async () => ({
      version: "0.7.5",
      protocol: 17,
      workspaces: [{ workspace_id: "w9R", label: workspaceLabel }],
      panes: [],
      agents: [],
    }),
    paneRead: async () => ({ text: BASH_PROMPT, revision: 1 }),
    paneSendText: async () => {},
    paneSendKeys: async (pane: string, pressed: string[]) => {
      keys.push({ pane, keys: pressed });
    },
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

  return { client, emitter, status, keys };
}

async function connect(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const received: Frame[] = [];
  const listeners: ((frame: Frame) => void)[] = [];
  socket.onmessage = (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    received.push(frame);
    for (const listener of [...listeners]) listener(frame);
  };
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.onopen = () => resolve();
  socket.onerror = () => reject(new Error("websocket failed to open"));
  await promise;

  return {
    received,
    send: (message: unknown) => socket.send(JSON.stringify(message)),
    waitFor(predicate: (frame: Frame) => boolean, timeoutMs = 5000): Promise<Frame> {
      const already = received.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise((resolveFrame, rejectFrame) => {
        const timer = setTimeout(() => {
          rejectFrame(
            new Error(`timed out; received ${JSON.stringify(received.map((f) => f.type))}`),
          );
        }, timeoutMs);
        listeners.push((frame) => {
          if (!predicate(frame)) return;
          clearTimeout(timer);
          resolveFrame(frame);
        });
      });
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = new Promise<void>((resolveClose) => {
        socket.onclose = () => resolveClose();
      });
      socket.close();
      await closed;
    },
  };
}

// A deadline, not a count of event-loop turns: see app-audit-wiring.test.ts.
async function until(condition: () => boolean, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await Bun.sleep(5);
  }
  if (condition()) return;
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Every file the assembled server would otherwise write under `~/.claude-mobile`. */
function tmpPaths() {
  const dir = mkdtempSync(join(tmpdir(), "ws-permission-reconnect-"));
  tmpDirs.push(dir);
  return {
    auditLogPath: join(dir, "audit.jsonl"),
    pushStore: createSubscriptionStore({ path: join(dir, "subs.json") }),
    pushAttemptLogPath: join(dir, "attempts.jsonl"),
  };
}

function isPermissionRequest(frame: Frame): boolean {
  return (
    frame.type === "event" && (frame.payload as Frame | undefined)?.type === "permission_request"
  );
}

describe("PermissionSurvivesReconnect", () => {
  test("an answer sent on a new socket presses the chosen key in the prompt's pane", async () => {
    const herdr = fakeHerdr();
    const backendRef: { current: AppBackend | null } = { current: null };
    const app = createApp(testServerConfig, {
      herdrClient: herdr.client as never,
      backendRef,
      gateEnv: {},
      agentProfiles: emptyAgentProfileSource(),
      ...tmpPaths(),
    });
    app.listen(0);
    const server = app.server;
    if (!server || server.port === undefined) throw new Error("app failed to listen");

    try {
      // The first listing is what opens the daemon's event stream.
      const first = await connect(server.port);
      first.send({ type: "list_terminal_sessions" });
      await first.waitFor((frame) => frame.type === "terminal_sessions");

      herdr.status.value = "blocked";
      herdr.emitter.emit?.({
        event: "pane_updated",
        data: { pane: { pane_id: PANE, agent: "claude", agent_status: "blocked" } },
      });
      const envelope = await first.waitFor(isPermissionRequest);
      const request = envelope.payload as { requestId: string; sessionId: string };
      expect(request.sessionId).toBe(PANE);

      await first.close();

      // What the phone sends on every open, before the user taps anything.
      const second = await connect(server.port);
      second.send({ type: "list_terminal_sessions" });
      await second.waitFor((frame) => frame.type === "terminal_sessions");

      // "3" rather than "1": the legacy `allow: true` form also presses the
      // first option, so only another option proves the optionId was honoured.
      second.send({ type: "permission", requestId: request.requestId, optionId: "3" });
      await until(() => herdr.keys.length > 0, "a key to reach the pane");

      expect(herdr.keys).toEqual([{ pane: PANE, keys: ["3"] }]);
      expect(second.received.filter((frame) => frame.type === "error")).toEqual([]);
      await second.close();
    } finally {
      await backendRef.current?.teardownAll();
      server.stop(true);
    }
  }, 15_000);
});

/**
 * A reconnect replays the session's buffer from the phone's cursor. A prompt
 * in it that was answered during the gap came back as a card for a question
 * nobody was asking any more (audit 2026-10-03 #3).
 */
describe("ResolvedPromptNotReplayed", () => {
  async function replayAfter(settle: (herdr: ReturnType<typeof fakeHerdr>) => void) {
    const herdr = fakeHerdr();
    const backendRef: { current: AppBackend | null } = { current: null };
    const app = createApp(testServerConfig, {
      herdrClient: herdr.client as never,
      backendRef,
      gateEnv: {},
      agentProfiles: emptyAgentProfileSource(),
      ...tmpPaths(),
    });
    app.listen(0);
    const server = app.server;
    if (!server || server.port === undefined) throw new Error("app failed to listen");

    try {
      const first = await connect(server.port);
      first.send({ type: "list_terminal_sessions" });
      await first.waitFor((frame) => frame.type === "terminal_sessions");

      herdr.status.value = "blocked";
      herdr.emitter.emit?.({
        event: "pane_updated",
        data: { pane: { pane_id: PANE, agent: "claude", agent_status: "blocked" } },
      });
      await first.waitFor(isPermissionRequest);
      settle(herdr);
      await first.close();

      const second = await connect(server.port);
      second.send({
        type: "reconnect",
        lastEventId: null,
        lastEventIds: { [PANE]: 0 },
        sessionIds: [PANE],
      });
      await second.waitFor((frame) => frame.type === "replay_complete");
      const replayed = second.received.filter((frame) => frame.type === "event");
      await second.close();
      return replayed;
    } finally {
      await backendRef.current?.teardownAll();
      server.stop(true);
    }
  }

  test("a prompt answered during the gap is not replayed", async () => {
    const replayed = await replayAfter((herdr) => {
      herdr.status.value = "idle";
      herdr.emitter.emit?.({
        event: "pane_updated",
        data: { pane: { pane_id: PANE, agent: "claude", agent_status: "idle" } },
      });
    });

    expect(replayed.some(isPermissionRequest)).toBe(false);
    // The rest of the buffer still goes: only the settled prompt is held back.
    expect(replayed.map((frame) => (frame.payload as Frame).type)).toContain("session_state");
  }, 15_000);

  test("a prompt still waiting is replayed", async () => {
    const replayed = await replayAfter(() => {});

    expect(replayed.filter(isPermissionRequest)).toHaveLength(1);
  }, 15_000);
});

const SELF_LAUNCHED = "ccm-0f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

async function assembled(workspaceLabel?: string) {
  const herdr = fakeHerdr(workspaceLabel);
  const eventBuffer = new EventBuffer(500);
  const backendRef: { current: AppBackend | null } = { current: null };
  const app = createApp(testServerConfig, {
    herdrClient: herdr.client as never,
    backendRef,
    gateEnv: {},
    agentProfiles: emptyAgentProfileSource(),
    eventBuffer,
    ...tmpPaths(),
  });
  app.listen(0);
  const server = app.server;
  if (!server || server.port === undefined) throw new Error("app failed to listen");
  const backend = backendRef.current as AppBackend | null;
  if (!backend) throw new Error("createApp did not hand back its backend");
  return {
    herdr,
    eventBuffer,
    backend,
    port: server.port,
    async stop() {
      await backend.teardownAll();
      server.stop(true);
    },
  };
}

function report(herdr: ReturnType<typeof fakeHerdr>, status: string) {
  herdr.status.value = status;
  herdr.emitter.emit?.({
    event: "pane_updated",
    data: { pane: { pane_id: PANE, agent: "claude", agent_status: status } },
  });
}

type Socket = Awaited<ReturnType<typeof connect>>;

/** What every open sends, and the card it brings back. */
async function listAndTakeCard(socket: Socket) {
  socket.send({ type: "list_terminal_sessions" });
  const envelope = await socket.waitFor(isPermissionRequest);
  // After the listing, never before it: the client files a card under a
  // session it already holds, and a pane it has never seen is created only by
  // the listing.
  const listedAt = socket.received.findIndex((frame) => frame.type === "terminal_sessions");
  expect(listedAt).toBeGreaterThanOrEqual(0);
  expect(listedAt).toBeLessThan(socket.received.indexOf(envelope));
  return envelope.payload as { requestId: string; autoDenyMs?: number };
}

/**
 * The push flow: claude blocks while the phone sleeps, the push wakes the user,
 * the app opens. What the phone sends on that open is a session listing, not a
 * prompt — and a phone that reloaded has neither the card nor a replay cursor
 * that predates it. The card has to come from the listing.
 */
describe("PermissionDeliveredOnReconnect", () => {
  test("a prompt raised while no phone was connected reaches the next one to list", async () => {
    const env = await assembled();
    try {
      const first = await connect(env.port);
      first.send({ type: "list_terminal_sessions" });
      await first.waitFor((frame) => frame.type === "terminal_sessions");
      await first.close();

      report(env.herdr, "blocked");
      await until(
        () =>
          env.eventBuffer
            .replay(PANE, -1)
            .some((event) => event.message?.type === "permission_request"),
        "the prompt raised in the gap",
      );

      const second = await connect(env.port);
      const card = await listAndTakeCard(second);
      second.send({ type: "permission", requestId: card.requestId, optionId: "3" });
      await until(() => env.herdr.keys.length > 0, "a key to reach the pane");

      expect(env.herdr.keys).toEqual([{ pane: PANE, keys: ["3"] }]);
      expect(second.received.filter((frame) => frame.type === "error")).toEqual([]);
      await second.close();
    } finally {
      await env.stop();
    }
  }, 15_000);

  test("a prompt already up before the drop reaches a phone that lost its card", async () => {
    const env = await assembled();
    try {
      const first = await connect(env.port);
      first.send({ type: "list_terminal_sessions" });
      await first.waitFor((frame) => frame.type === "terminal_sessions");
      report(env.herdr, "blocked");
      await first.waitFor(isPermissionRequest);
      await first.close();

      const second = await connect(env.port);
      const card = await listAndTakeCard(second);
      second.send({ type: "permission", requestId: card.requestId, optionId: "3" });
      await until(() => env.herdr.keys.length > 0, "a key to reach the pane");

      expect(env.herdr.keys).toEqual([{ pane: PANE, keys: ["3"] }]);
      await second.close();
    } finally {
      await env.stop();
    }
  }, 15_000);

  test("the countdown frozen by the drop runs again from the card the listing raises", async () => {
    const env = await assembled(SELF_LAUNCHED);
    try {
      const first = await connect(env.port);
      first.send({ type: "list_terminal_sessions" });
      await first.waitFor((frame) => frame.type === "terminal_sessions");
      report(env.herdr, "blocked");
      const raised = (await first.waitFor(isPermissionRequest)).payload as { requestId: string };
      expect(env.backend.permissionAutoDenyMs?.(raised.requestId)).toBeNumber();

      await first.close();
      await until(
        () => env.backend.permissionAutoDenyMs?.(raised.requestId) === undefined,
        "the drop to freeze the countdown",
      );

      const second = await connect(env.port);
      // Connected is not shown: until the listing raises the card again the
      // phone has nothing to answer, so nothing counts down.
      expect(env.backend.permissionAutoDenyMs?.(raised.requestId)).toBeUndefined();
      const card = await listAndTakeCard(second);

      expect(card.autoDenyMs).toBeGreaterThan(0);
      expect(card.autoDenyMs).toBeLessThanOrEqual(90_000);
      expect(env.backend.permissionAutoDenyMs?.(card.requestId)).toBeNumber();

      // Settling the prompt is what clears its real 90 s timer.
      report(env.herdr, "idle");
      await until(
        () => env.backend.permissionAutoDenyMs?.(card.requestId) === undefined,
        "the settled prompt to drop its countdown",
      );
      await second.close();
    } finally {
      await env.stop();
    }
  }, 15_000);
});
