/**
 * backend.test.ts — HerdrStartupGate + the composed adapter's port behaviour.
 *
 * The startup cases drive the real `assertCompatible` through an injected
 * transport, so the protocol check under test is the production one.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { createApp } from "../app";
import { parseServerConfig } from "../config";
import { createPtyResponseRelay } from "../pty-response-relay";
import { createHerdrBackend, type HerdrBackendOptions, verifyHerdrStartup } from "./backend";
import { createHerdrClient } from "./client";
import { HerdrTransportError } from "./errors";

const UUID = "3f2a9b01-1111-4222-8333-444455556666";

const settingsWritten = new Set<string>();

afterEach(async () => {
  for (const path of settingsWritten) {
    try {
      if (existsSync(path)) await unlink(path);
    } catch {
      // ignore
    }
  }
  settingsWritten.clear();
});

/** A per-method result, or a function of the params for pane-dependent replies. */
type FakeResult = unknown | ((params: unknown) => unknown);

function makeFakeClient(results: Record<string, FakeResult> = {}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const subscriptions: unknown[] = [];
  const injected: Array<[string, unknown]> = [];
  let stopCalls = 0;

  // One cast at the boundary: the fake covers the slice the backend uses, not
  // the client's full generic surface.
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (method in results) {
        const result = results[method];
        return typeof result === "function" ? result(params) : result;
      }
      if (method === "workspace.create") {
        return {
          type: "workspace_created",
          workspace: { workspace_id: "w1" },
          root_pane: { pane_id: "p1" },
        };
      }
      return { type: "ok" };
    },
    agentGet: async () => ({ interactive_ready: true }),
    paneSendText: async (paneId: string, text: string) => {
      injected.push([paneId, text]);
    },
    paneSendKeys: async (paneId: string, keys: string[]) => {
      injected.push([paneId, keys]);
    },
    subscribeEvents: async (options: { subscriptions: unknown }) => {
      subscriptions.push(options.subscriptions);
      return {
        stop: () => {
          stopCalls += 1;
        },
      };
    },
  } as unknown as NonNullable<HerdrBackendOptions["client"]>;

  return { client, calls, subscriptions, injected, stopCalls: () => stopCalls };
}

/** Keeps a handle on the relay so tests can drive a Stop-hook resolution. */
function makeBackend(fake: ReturnType<typeof makeFakeClient>) {
  const relay = createPtyResponseRelay();
  const backend = createHerdrBackend({
    client: fake.client,
    responseRelay: relay,
    responseUrl: "http://127.0.0.1:3001/api/pty-response",
  });
  return { backend, relay };
}

describe("herdr backend composition", () => {
  test("createSession returns the port shape and starts the status subscription", async () => {
    const fake = makeFakeClient();
    const { backend } = makeBackend(fake);

    const info = await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    settingsWritten.add(info.settingsPath);

    expect(info.name).toBe("ccm-3f2a9b01");
    expect(info.paneRef).toBe("p1");
    expect(Object.keys(info).sort()).toEqual(["name", "paneRef", "settingsPath"]);
    expect(fake.subscriptions[0]).toEqual([{ type: "pane.agent_status_changed", pane_id: "p1" }]);
    expect(backend.hasSession(UUID)).toEqual({ present: true, paneRef: "p1" });
    expect(backend.listLive()).toEqual([UUID]);
  });

  test("permissionMode passes through to the launched claude argv", async () => {
    const fake = makeFakeClient();
    const backend = createHerdrBackend({
      client: fake.client,
      responseRelay: createPtyResponseRelay(),
      permissionMode: "acceptEdits",
    });

    const info = await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    settingsWritten.add(info.settingsPath);

    const start = fake.calls.find((call) => call.method === "agent.start");
    const args = (start?.params as { args: string[] }).args;
    const pmIdx = args.indexOf("--permission-mode");
    expect(pmIdx).toBeGreaterThanOrEqual(0);
    expect(args[pmIdx + 1]).toBe("acceptEdits");
  });

  test("teardown stops the subscription, closes the workspace and deregisters", async () => {
    const fake = makeFakeClient();
    const { backend } = makeBackend(fake);
    const info = await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    settingsWritten.add(info.settingsPath);

    const result = await backend.teardown(UUID);

    expect(result).toEqual({ killed: true });
    expect(fake.stopCalls()).toBe(1);
    expect(fake.calls.some((call) => call.method === "workspace.close")).toBe(true);
    expect(backend.hasSession(UUID)).toEqual({ present: false });
  });

  test("teardownAll releases every session through the composed teardown", async () => {
    const fake = makeFakeClient();
    const { backend } = makeBackend(fake);
    settingsWritten.add(
      (await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" })).settingsPath,
    );
    settingsWritten.add(
      (await backend.createSession({ claudeUuid: "7c4d5e02-2222-4333-8444-5555", cwd: "/tmp" }))
        .settingsPath,
    );

    await backend.teardownAll();

    expect(backend.listLive()).toEqual([]);
    // Both subscriptions stopped — not just the workspaces closed.
    expect(fake.stopCalls()).toBe(2);
  });

  test("remountLiveSessions makes an adopted pane routable and subscribed", async () => {
    const uuid = "3f2b8c1d-9e4a-4b6f-8c2d-1a5e7f9b0c3d";
    const fake = makeFakeClient({
      "session.snapshot": {
        type: "session_snapshot",
        snapshot: {
          version: "0.7.5",
          protocol: 17,
          workspaces: [
            {
              workspace_id: "ws-1",
              label: `ccm-${uuid}`,
              number: 1,
              focused: false,
              active_tab_id: "ws-1:t1",
              tab_count: 1,
              pane_count: 1,
              agent_status: "idle",
            },
          ],
          tabs: [],
          panes: [
            {
              pane_id: "pn-1",
              terminal_id: "term-1",
              workspace_id: "ws-1",
              tab_id: "ws-1:t1",
              focused: false,
              agent_status: "working",
              revision: 4,
              agent: "claude",
            },
          ],
          layouts: [],
          agents: [],
        },
      },
      "pane.process_info": {
        type: "pane_process_info",
        process_info: {
          pane_id: "pn-1",
          foreground_processes: [
            { pid: 1, argv0: "claude", argv: ["claude", "--session-id", uuid] },
          ],
        },
      },
    });
    const { backend } = makeBackend(fake);

    const report = await backend.remountLiveSessions();

    expect(report.adopted).toEqual([uuid]);
    // Adopted through the same registry the port reads from, so the session is
    // routable — and subscribed — exactly as a created one would be.
    expect(backend.listLive()).toEqual([uuid]);
    expect(backend.hasSession(uuid)).toEqual({ present: true, paneRef: "pn-1" });
    expect(fake.subscriptions[0]).toEqual([{ type: "pane.agent_status_changed", pane_id: "pn-1" }]);

    // A prompt now reaches the adopted pane with no create in between. The sink
    // is bound the way ws.ts binds it — on the first terminal_send of the reconnected
    // client — which is exactly what a remounted session depends on.
    backend.registerClient(uuid, () => {});
    await backend.send({ claudeUuid: uuid, content: "hi" });
    expect(fake.injected[0]).toEqual(["pn-1", "hi"]);
  });

  test("listUnknown carries remount skips and stays disjoint from listLive", async () => {
    const adoptedUuid = "3f2b8c1d-9e4a-4b6f-8c2d-1a5e7f9b0c3d";
    const skippedUuid = "7c4d5e02-2222-4333-8444-555566667777";
    const makeWorkspace = (id: string, uuid: string) => ({
      workspace_id: id,
      label: `ccm-${uuid}`,
      number: 1,
      focused: false,
      active_tab_id: `${id}:t1`,
      tab_count: 1,
      pane_count: 1,
      agent_status: "idle",
    });
    const makePane = (id: string, workspaceId: string) => ({
      pane_id: id,
      terminal_id: `term-${id}`,
      workspace_id: workspaceId,
      tab_id: `${workspaceId}:t1`,
      focused: false,
      agent_status: "working",
      revision: 4,
      agent: "claude",
    });
    const fake = makeFakeClient({
      "session.snapshot": {
        type: "session_snapshot",
        snapshot: {
          version: "0.7.5",
          protocol: 17,
          workspaces: [makeWorkspace("ws-1", adoptedUuid), makeWorkspace("ws-2", skippedUuid)],
          tabs: [],
          panes: [makePane("pn-1", "ws-1"), makePane("pn-2", "ws-2")],
          layouts: [],
          agents: [],
        },
      },
      "pane.process_info": (params: unknown) => {
        const paneId = (params as { pane_id: string }).pane_id;
        // pn-2 is unreachable on both the probe and its retry → skipped.
        if (paneId === "pn-2") throw new Error("daemon busy");
        return {
          type: "pane_process_info",
          process_info: {
            pane_id: paneId,
            foreground_processes: [
              { pid: 1, argv0: "claude", argv: ["claude", "--session-id", adoptedUuid] },
            ],
          },
        };
      },
    });
    const { backend } = makeBackend(fake);

    expect(backend.listUnknown()).toEqual([]);

    const report = await backend.remountLiveSessions();

    // The split the client will see: adopted answers as live, skipped answers
    // as unknown — never as dead, never in both lists.
    expect(report.adopted).toEqual([adoptedUuid]);
    expect(report.skipped.map((entry) => entry.uuid)).toEqual([skippedUuid]);
    expect(backend.listLive()).toEqual([adoptedUuid]);
    expect(backend.listUnknown()).toEqual([skippedUuid]);

    // A uuid that becomes routable after the scan answers as live, not unknown.
    const info = await backend.createSession({ claudeUuid: skippedUuid, cwd: "/tmp" });
    settingsWritten.add(info.settingsPath);
    expect(backend.listUnknown()).toEqual([]);
  });

  test("a prompt reaches the created pane and its reply comes back on the shared relay", async () => {
    const fake = makeFakeClient();
    const { backend, relay } = makeBackend(fake);
    const info = await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    settingsWritten.add(info.settingsPath);

    const seen: Record<string, unknown>[] = [];
    backend.registerClient(UUID, (msg) => seen.push(msg));
    await backend.send({ claudeUuid: UUID, content: "line1\nline2" });

    // The pane the registry recorded at create is the pane the prompt went to.
    expect(fake.injected).toEqual([
      ["p1", "line1\nline2"],
      ["p1", ["Enter"]],
    ]);

    // The relay the caller passed in is the one the reply path awaits — this is
    // the instance app.ts also hands to the Stop-hook HTTP endpoint.
    expect(relay.hasPending(UUID)).toBe(true);
    relay.resolveResponse(UUID, "hello");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen.length).toBe(2);
    expect(seen[0]).toMatchObject({
      type: "stream_chunk",
      sessionId: UUID,
      chunk: {
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }], stop_reason: "end_turn" },
      },
    });
    expect(seen[1]).toEqual({ type: "stream_end", sessionId: UUID });
  });
});

describe("HerdrStartupGate", () => {
  test("rejects when the daemon speaks a different protocol", async () => {
    const client = createHerdrClient({
      transport: {
        request: async () => ({
          type: "pong",
          version: "0.6.0",
          protocol: 16,
          capabilities: {},
        }),
      },
    });

    await expect(verifyHerdrStartup(client)).rejects.toThrow(/protocol 17/);
  });

  test("rejects naming the socket path when the daemon is unreachable", async () => {
    const client = createHerdrClient({
      transport: {
        request: async () => {
          throw new HerdrTransportError("connect failed: ENOENT");
        },
      },
    });

    await expect(verifyHerdrStartup(client, "/tmp/no-such-herdr.sock")).rejects.toThrow(
      /\/tmp\/no-such-herdr\.sock/,
    );
  });

  test("resolves when the daemon speaks the supported protocol", async () => {
    const client = createHerdrClient({
      transport: {
        request: async () => ({
          type: "pong",
          version: "0.7.5",
          protocol: 17,
          capabilities: {},
        }),
      },
    });

    await expect(verifyHerdrStartup(client)).resolves.toBeUndefined();
  });

  test("createApp and the default backend construct without contacting a daemon", () => {
    const serverConfig = parseServerConfig(["bun", "server/index.ts"]);

    expect(() => createApp(serverConfig)).not.toThrow();

    const backend = createHerdrBackend({ responseRelay: createPtyResponseRelay() });
    expect(backend.hasSession("x")).toEqual({ present: false });
    expect(backend.listLive()).toEqual([]);
  });
});
