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

  test("listSessionDescriptors reports every claude the daemon has, self or foreign", async () => {
    const foreignPane = "w9:p1";
    const fake = makeFakeClient({
      "session.snapshot": {
        type: "session_snapshot",
        snapshot: {
          version: "0.7.5",
          protocol: 17,
          workspaces: [{ workspace_id: "w9", label: "dev" }],
          tabs: [],
          panes: [],
          layouts: [],
          agents: [],
        },
      },
      "pane.process_info": (params: unknown) => ({
        type: "pane_process_info",
        process_info: {
          pane_id: (params as { pane_id: string }).pane_id,
          foreground_processes: [
            { pid: 1, argv0: "claude", argv: ["claude", "--permission-mode", "default"] },
          ],
        },
      }),
    });
    const snapshot = {
      version: "0.7.5",
      protocol: 17,
      workspaces: [{ workspace_id: "w9", label: "dev" }],
      panes: [],
      agents: [],
    };
    const backend = createHerdrBackend({
      client: {
        ...fake.client,
        sessionSnapshot: async () => snapshot,
        agentList: async () => [
          {
            terminal_id: "t1",
            agent_status: "idle",
            workspace_id: "w9",
            tab_id: "w9:t1",
            pane_id: foreignPane,
            focused: false,
            revision: 3,
            agent: "claude",
            cwd: "/repo",
            agent_session: { kind: "id", value: "a21273d4-77e6-43dc-b9cb-3647561d1192" },
          },
        ],
        agentGet: async (target: string) => ({
          terminal_id: "t1",
          agent_status: "idle",
          workspace_id: "w9",
          tab_id: "w9:t1",
          pane_id: target,
          focused: false,
          revision: 3,
          agent: "claude",
          cwd: "/repo",
          agent_session: { kind: "id", value: "a21273d4-77e6-43dc-b9cb-3647561d1192" },
        }),
      },
      responseRelay: createPtyResponseRelay(),
    } as unknown as HerdrBackendOptions);

    const sessions = await backend.listSessionDescriptors();

    // Nothing was created through this backend, and the pane still lists: the
    // daemon is the source of truth now, not the in-process registry.
    expect(backend.listLive()).toEqual([]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: foreignPane,
      origin: "foreign",
      drivable: true,
      readable: true,
      gated: true,
      cwd: "/repo",
    });
  });

  test("listSessionDescriptors answers empty rather than throwing without a listing client", async () => {
    const fake = makeFakeClient();
    const { backend } = makeBackend(fake);

    expect(await backend.listSessionDescriptors()).toEqual([]);
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
