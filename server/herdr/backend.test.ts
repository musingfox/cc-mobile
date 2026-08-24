/**
 * backend.test.ts — HerdrStartupGate + the composed adapter's port behaviour.
 *
 * The startup cases drive the real `assertCompatible` through an injected
 * transport, so the protocol check under test is the production one.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { parseServerConfig } from "../config";
import { createSubscriptionStore } from "../push/subscription-store";
import {
  createHerdrBackend,
  type HerdrBackendOptions,
  permissionAppliesTo,
  verifyHerdrStartup,
} from "./backend";
import { createHerdrClient } from "./client";
import { HerdrTransportError } from "./errors";

const UUID = "3f2a9b01-1111-4222-8333-444455556666";

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

function makeBackend(fake: ReturnType<typeof makeFakeClient>) {
  const backend = createHerdrBackend({ client: fake.client });
  return { backend };
}

describe("herdr backend composition", () => {
  test("createSession returns the port shape and opens the global event stream", async () => {
    const fake = makeFakeClient();
    const { backend } = makeBackend(fake);

    const info = await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    expect(info.name).toBe("ccm-3f2a9b01");
    expect(info.paneRef).toBe("p1");
    // No settingsPath: the port stopped carrying one when the hook pipeline
    // that needed it was deleted.
    expect(Object.keys(info).sort()).toEqual(["name", "paneRef"]);
    // One global stream, not one per pane: a filter carrying a pane_id could
    // never see the sessions the user starts in their own terminal.
    expect(fake.subscriptions).toEqual([[{ type: "pane.updated" }]]);
    expect(backend.hasSession(UUID)).toEqual({ present: true, paneRef: "p1" });
    expect(backend.listLive()).toEqual([UUID]);
  });

  test("launches with no gating flag, whatever the caller wants", async () => {
    const fake = makeFakeClient();
    const backend = createHerdrBackend({ client: fake.client });

    await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    const start = fake.calls.find((call) => call.method === "agent.start");
    const args = (start?.params as { args: string[] }).args;
    // There is no longer any way to ask for one: the option is gone from the
    // backend's surface, and the agent runs at its own settings.
    expect(args).not.toContain("--permission-mode");
  });

  test("teardown closes the workspace and deregisters the session", async () => {
    const fake = makeFakeClient();
    const { backend } = makeBackend(fake);
    const info = await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    const result = await backend.teardown(UUID);

    expect(result).toEqual({ killed: true });
    expect(fake.calls.some((call) => call.method === "workspace.close")).toBe(true);
    expect(backend.hasSession(UUID)).toEqual({ present: false });
  });

  test("teardownAll releases every session through the composed teardown", async () => {
    const fake = makeFakeClient();
    const { backend } = makeBackend(fake);
    await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    await backend.createSession({ claudeUuid: "7c4d5e02-2222-4333-8444-5555", cwd: "/tmp" });

    await backend.teardownAll();

    expect(backend.listLive()).toEqual([]);
    expect(fake.calls.filter((call) => call.method === "workspace.close")).toHaveLength(2);
    // And the one shared event stream — with the status poll behind it — is
    // closed too. It belongs to the backend, so no per-session teardown reaches
    // it, and a backend left running one polls the daemon forever.
    expect(fake.stopCalls()).toBe(1);
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

  test("a prompt reaches the created pane, and nothing waits on a hook for the reply", async () => {
    const fake = makeFakeClient();
    const { backend } = makeBackend(fake);
    await backend.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    const seen: Record<string, unknown>[] = [];
    backend.registerClient(UUID, (msg) => seen.push(msg));
    await backend.send({ claudeUuid: UUID, content: "line1\nline2" });

    // The pane the registry recorded at create is the pane the prompt went to.
    expect(fake.injected).toEqual([
      ["p1", "line1\nline2"],
      ["p1", ["Enter"]],
    ]);
    // Injecting emits nothing by itself: the reply arrives later, read out of
    // claude's transcript when herdr reports the turn settled.
    expect(seen).toEqual([]);
  });
});

// ── NonClaudePermissionSuppression ───────────────────────────────────────────

describe("NonClaudePermissionSuppression", () => {
  /** A backend whose event stream a test can drive, recording what it reads. */
  function eventDrivenBackend() {
    const reads: string[] = [];
    let emit: ((event: { event: string; data: unknown }) => void) | undefined;

    const client = {
      call: async () => ({ type: "ok" }),
      agentGet: async () => ({ agent_status: "blocked" }),
      // The first thing the permission flow does with a `blocked` pane: read
      // its screen. No read means it was never asked.
      paneRead: async (params: { pane_id: string }) => {
        reads.push(params.pane_id);
        return { text: "", revision: 1 };
      },
      paneSendText: async () => {},
      paneSendKeys: async () => {},
      subscribeEvents: async (options: {
        onEvent: (event: { event: string; data: unknown }) => void;
      }) => {
        emit = options.onEvent;
        return { stop: () => {} };
      },
    } as unknown as NonNullable<HerdrBackendOptions["client"]>;

    const backend = createHerdrBackend({ client });
    const sent: Record<string, unknown>[] = [];

    return {
      backend,
      reads,
      sent,
      async open(sessionId: string) {
        backend.registerClient(sessionId, (msg) => sent.push(msg));
        await backend.listSessionDescriptors();
      },
      async report(paneId: string, status: string, agent?: string) {
        emit?.({
          event: "pane_updated",
          data: { pane: { pane_id: paneId, agent_status: status, ...(agent ? { agent } : {}) } },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    };
  }

  test("a pane running an agent with no parser raises no prompt when it blocks", async () => {
    const h = eventDrivenBackend();
    await h.open("w6C:p1");

    await h.report("w6C:p1", "blocked", "codex");

    // Not read, not parsed, not shown: on a screen no parser understands, the
    // Cancel-only fallback would send `esc` on a guess about what that key does
    // in that TUI.
    expect(h.reads).toEqual([]);
    expect(h.sent.some((msg) => msg.type === "permission_request")).toBe(false);
  });

  test("a blocked omp reaches the permission flow too, since #33 parses it", async () => {
    const h = eventDrivenBackend();
    await h.open("w6C:p1");

    await h.report("w6C:p1", "blocked", "omp");

    expect(h.reads).toEqual(["w6C:p1"]);
  });

  test("a blocked claude still reaches the permission flow", async () => {
    const h = eventDrivenBackend();
    await h.open("w3V:p1");

    await h.report("w3V:p1", "blocked", "claude");

    expect(h.reads).toEqual(["w3V:p1"]);
  });

  test("a pane of unreported kind is treated as claude, not as suspect", async () => {
    const h = eventDrivenBackend();
    await h.open("w9:p1");

    await h.report("w9:p1", "blocked");

    // Detection lags the first status report, and a swallowed prompt cannot be
    // recovered inside that turn — see permissionAppliesTo.
    expect(h.reads).toEqual(["w9:p1"]);
  });

  test("every non-blocked status is forwarded whatever the kind", () => {
    expect(permissionAppliesTo("idle", "codex")).toBe(true);
    expect(permissionAppliesTo("working", "codex")).toBe(true);
    // Leaving `blocked` is what drops a pending prompt and disarms its 90 s
    // esc timer; filtering those by kind would strand both.
    expect(permissionAppliesTo("blocked", "codex")).toBe(false);
    // The two kinds with a parser and a keystroke model of their own.
    expect(permissionAppliesTo("blocked", "claude")).toBe(true);
    expect(permissionAppliesTo("blocked", "omp")).toBe(true);
    expect(permissionAppliesTo("blocked", undefined)).toBe(true);
  });

  test("an empty kind forwards, the same as an absent one", () => {
    // Today pane-events only ever hands over undefined or a non-empty string,
    // but this predicate is exported: a caller passing herdr's raw label through
    // must not have its prompt swallowed by an empty string reading as
    // "known non-claude".
    expect(permissionAppliesTo("blocked", "")).toBe(true);
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

    await expect(verifyHerdrStartup(client)).rejects.toThrow(/protocol 20/);
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
          version: "0.8.2",
          protocol: 20,
          capabilities: {},
        }),
      },
    });

    await expect(verifyHerdrStartup(client)).resolves.toBeUndefined();
  });

  test("createApp and the default backend construct without contacting a daemon", () => {
    const serverConfig = parseServerConfig(["bun", "server/index.ts"]);

    // Push paths into a tmpdir: the defaults live in the developer's own
    // `~/.claude-mobile/`, and no test may construct anything there.
    const pushTmp = mkdtempSync(join(tmpdir(), "backend-app-push-"));
    try {
      expect(() =>
        createApp(serverConfig, {
          pushStore: createSubscriptionStore({ path: join(pushTmp, "subs.json") }),
          pushAttemptLogPath: join(pushTmp, "attempts.jsonl"),
        }),
      ).not.toThrow();
    } finally {
      rmSync(pushTmp, { recursive: true, force: true });
    }

    const backend = createHerdrBackend({});
    expect(backend.hasSession("x")).toEqual({ present: false });
    expect(backend.listLive()).toEqual([]);
  });

  // wiring T3 covered: push absent ok (see push/wiring.test)
});

// ── TeardownOwnershipGuard ───────────────────────────────────────────────────

describe("TeardownOwnershipGuard", () => {
  const SELF_UUID = "3f2a9b01-1111-4222-8333-444455556666";

  /** A daemon holding one cc-mobile workspace (w1) and one the user opened (w9). */
  function listingBackend() {
    const calls: { method: string; params: unknown }[] = [];
    const panes = [
      { pane_id: "w1:p1", workspace_id: "w1" },
      { pane_id: "w9:p1", workspace_id: "w9" },
    ];
    const agentInfo = (paneId: string, workspaceId: string) => ({
      terminal_id: "t1",
      agent_status: "idle",
      workspace_id: workspaceId,
      tab_id: `${workspaceId}:t1`,
      pane_id: paneId,
      focused: false,
      revision: 1,
      agent: "claude",
      cwd: "/repo",
      agent_session: { kind: "id", value: "a21273d4-77e6-43dc-b9cb-3647561d1192" },
    });

    const client = {
      call: async (method: string, params: unknown) => {
        calls.push({ method, params });
        if (method === "pane.process_info") {
          return {
            type: "pane_process_info",
            process_info: {
              pane_id: (params as { pane_id: string }).pane_id,
              foreground_processes: [
                { pid: 1, argv0: "claude", argv: ["claude", "--permission-mode", "default"] },
              ],
            },
          };
        }
        return { type: "ok" };
      },
      agentGet: async (target: string) => {
        const pane = panes.find((entry) => entry.pane_id === target);
        if (!pane) throw new Error("agent_not_found");
        return agentInfo(pane.pane_id, pane.workspace_id);
      },
      agentList: async () => panes.map((pane) => agentInfo(pane.pane_id, pane.workspace_id)),
      sessionSnapshot: async () => ({
        version: "0.7.5",
        protocol: 17,
        workspaces: [
          { workspace_id: "w1", label: `ccm-${SELF_UUID}` },
          { workspace_id: "w9", label: "dev" },
        ],
        panes: [],
        agents: [],
      }),
      paneSendText: async () => {},
      paneSendKeys: async () => {},
      subscribeEvents: async () => ({ stop: () => {} }),
    };

    const backend = createHerdrBackend({
      client: client as unknown as NonNullable<HerdrBackendOptions["client"]>,
    });
    return { backend, calls };
  }

  test("closes the workspace of a pane cc-mobile launched", async () => {
    const { backend, calls } = listingBackend();

    const result = await backend.teardown("w1:p1");

    expect(result).toEqual({ killed: true });
    const closes = calls.filter((call) => call.method === "workspace.close");
    expect(closes).toEqual([{ method: "workspace.close", params: { workspace_id: "w1" } }]);
  });

  test("refuses a pane the user opened, issuing no RPC at all", async () => {
    const { backend, calls } = listingBackend();

    const result = await backend.teardown("w9:p1");

    expect(result).toEqual({ killed: false, reason: "not_owned" });
    expect(calls.some((call) => call.method === "workspace.close")).toBe(false);
  });

  test("a session the daemon no longer has is closed idempotently, not an error", async () => {
    const { backend, calls } = listingBackend();

    const result = await backend.teardown("gone:p1");

    expect(result).toEqual({ killed: false });
    expect(calls.some((call) => call.method === "workspace.close")).toBe(false);
  });
});

describe("CapabilitiesBackendPort", () => {
  type Listing = { sessionId: string; agent?: string; cwd: string };

  function portBackend(input: {
    listing: Listing[] | (() => Promise<Listing[]>);
    fetch?: () => Promise<{ ok: true; commands: { name: string }[]; agents: { name: string }[] } | { ok: false }>;
  }) {
    let fetchCalls = 0;
    const listingFn =
      typeof input.listing === "function" ? input.listing : async () => input.listing as Listing[];
    const backend = createHerdrBackend({
      capabilitiesListing: listingFn,
      capabilityFetcherFor: (agent) => {
        if (agent !== "claude") return undefined;
        return {
          list: async () => {
            fetchCalls += 1;
            if (!input.fetch) {
              return { ok: true as const, commands: [{ name: "help" }], agents: [{ name: "Explore" }] };
            }
            return input.fetch();
          },
        };
      },
    });
    return {
      backend,
      fetchCalls: () => fetchCalls,
    };
  }

  test("T1: a listed claude session returns the enriched list", async () => {
    const { backend } = portBackend({
      listing: [{ sessionId: "w1:p1", agent: "claude", cwd: "/repo" }],
      fetch: async () => ({
        ok: true,
        commands: [{ name: "help" }],
        agents: [{ name: "Explore" }],
      }),
    });
    await expect(backend.readCapabilities("w1:p1")).resolves.toEqual({
      ok: true,
      commands: [{ name: "help" }],
      agents: [{ name: "Explore" }],
    });
  });

  test("T2: a session the listing does not carry is unsupported", async () => {
    const { backend, fetchCalls } = portBackend({
      listing: [{ sessionId: "w1:p1", agent: "claude", cwd: "/repo" }],
    });
    await expect(backend.readCapabilities("w9:p9")).resolves.toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(fetchCalls()).toBe(0);
  });

  test("T3: an unknown kind is unsupported and never probes", async () => {
    const { backend, fetchCalls } = portBackend({
      listing: [{ sessionId: "w1:p1", agent: "gemini", cwd: "/repo" }],
    });
    await expect(backend.readCapabilities("w1:p1")).resolves.toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(fetchCalls()).toBe(0);
  });

  test("T4: a listing with no agent is unsupported and never probes", async () => {
    const { backend, fetchCalls } = portBackend({
      listing: [{ sessionId: "w1:p1", cwd: "/repo" }],
    });
    await expect(backend.readCapabilities("w1:p1")).resolves.toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(fetchCalls()).toBe(0);
  });

  test("T5: a failed fetch is a failed read, not unsupported", async () => {
    const { backend } = portBackend({
      listing: [{ sessionId: "w1:p1", agent: "claude", cwd: "/repo" }],
      fetch: async () => ({ ok: false }),
    });
    await expect(backend.readCapabilities("w1:p1")).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
  });

  test("T6: a listing that rejects resolves failed, never rejects", async () => {
    const { backend } = portBackend({
      listing: async () => {
        throw new Error("daemon down");
      },
    });
    await expect(backend.readCapabilities("w1:p1")).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
  });

  test("T7: two sessions of the same kind and cwd share one fetch", async () => {
    const { backend, fetchCalls } = portBackend({
      listing: [
        { sessionId: "w1:p1", agent: "claude", cwd: "/repo" },
        { sessionId: "w1:p2", agent: "claude", cwd: "/repo" },
      ],
    });
    await backend.readCapabilities("w1:p1");
    await backend.readCapabilities("w1:p2");
    expect(fetchCalls()).toBe(1);
  });

  test("T8: refresh:true re-fetches after a cached success", async () => {
    const { backend, fetchCalls } = portBackend({
      listing: [{ sessionId: "w1:p1", agent: "claude", cwd: "/repo" }],
    });
    await backend.readCapabilities("w1:p1");
    await backend.readCapabilities("w1:p1", { refresh: true });
    expect(fetchCalls()).toBe(2);
  });
});

// ── BlockedScreenNoticeDelivery (backend wiring) ─────────────────────────────

describe("BlockedScreenNoticeDelivery wiring", () => {
  const OMP_NO_API_KEY = readFileSync(
    join(import.meta.dir, "permission/fixtures/omp-no-api-key.txt"),
    "utf8",
  );
  const OMP_API_FAILURE = readFileSync(
    join(import.meta.dir, "permission/fixtures/omp-api-failure.txt"),
    "utf8",
  );

  function noticeBackend(screen: string) {
    let emit: ((event: { event: string; data: unknown }) => void) | undefined;
    const client = {
      call: async () => ({ type: "ok" }),
      agentGet: async () => ({ agent_status: "blocked" }),
      paneRead: async () => ({ text: screen, revision: 1 }),
      paneSendText: async () => {},
      paneSendKeys: async () => {},
      subscribeEvents: async (options: {
        onEvent: (event: { event: string; data: unknown }) => void;
      }) => {
        emit = options.onEvent;
        return { stop: () => {} };
      },
    } as unknown as NonNullable<HerdrBackendOptions["client"]>;

    const backend = createHerdrBackend({ client });
    const sent: Record<string, unknown>[] = [];
    return {
      sent,
      async open(sessionId: string) {
        backend.registerClient(sessionId, (msg) => sent.push(msg));
        await backend.listSessionDescriptors();
      },
      async report(paneId: string, status: string, agent?: string) {
        emit?.({
          event: "pane_updated",
          data: { pane: { pane_id: paneId, agent_status: status, ...(agent ? { agent } : {}) } },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    };
  }

  test("an omp API-key screen reaches the phone as an error frame, not a prompt", async () => {
    const h = noticeBackend(OMP_NO_API_KEY + "\n");
    await h.open("w3V:p1");
    await h.report("w3V:p1", "blocked", "omp");
    const notices = h.sent.filter((msg) => msg.type === "error");
    expect(notices).toEqual([
      {
        type: "error",
        code: "agent_blocked_notice",
        sessionId: "w3V:p1",
        message: "\n```\nError: No API key found for anthropic.\n```",
      },
    ]);
    expect(h.sent.some((msg) => msg.type === "permission_request")).toBe(false);
  });

  test("an omp 429 screen is announced once even if the pane ticks again", async () => {
    const h = noticeBackend(OMP_API_FAILURE);
    await h.open("w3V:p1");
    await h.report("w3V:p1", "blocked", "omp");
    await h.report("w3V:p1", "blocked", "omp");
    const notices = h.sent.filter((msg) => msg.code === "agent_blocked_notice");
    expect(notices).toHaveLength(1);
    expect(String(notices[0]?.message)).toContain("429");
    expect(h.sent.some((msg) => msg.type === "permission_request")).toBe(false);
  });

  test("an empty omp blocked screen sends no frames", async () => {
    const h = noticeBackend("");
    await h.open("w3V:p1");
    await h.report("w3V:p1", "blocked", "omp");
    expect(h.sent.filter((msg) => msg.type === "error" || msg.type === "permission_request")).toEqual([]);
  });
});

// ── ClaudeIdleAttentionNoticeDelivery (backend wiring) ───────────────────────

describe("ClaudeIdleAttentionNoticeDelivery wiring", () => {
  const TRUST_DIALOG = readFileSync(
    join(import.meta.dir, "permission/fixtures/trust-dialog.txt"),
    "utf8",
  );
  const IDLE_COMPOSER = readFileSync(
    join(import.meta.dir, "permission/fixtures/claude-idle-composer.txt"),
    "utf8",
  );
  const BASH_PROMPT = readFileSync(
    join(import.meta.dir, "permission/fixtures/blocked-bash-prompt.txt"),
    "utf8",
  );

  function attentionBackend(opts: {
    screen: string;
    paneRead?: "ok" | "missing" | "throw";
    keys?: { pane: string; keys: string[] }[];
  }) {
    let emit: ((event: { event: string; data: unknown }) => void) | undefined;
    const reads: unknown[] = [];
    const keys = opts.keys ?? [];
    const mode = opts.paneRead ?? "ok";
    const client = {
      call: async () => ({ type: "ok" }),
      agentGet: async () => ({ agent_status: "idle" }),
      paneRead:
        mode === "missing"
          ? undefined
          : mode === "throw"
            ? () => {
                reads.push("throw");
                throw new Error("sync paneRead boom");
              }
            : async () => {
                reads.push("read");
                return { text: opts.screen, revision: 1 };
              },
      paneSendText: async () => {},
      paneSendKeys: async (paneId: string, sent: string[]) => {
        keys.push({ pane: paneId, keys: sent });
      },
      subscribeEvents: async (options: {
        onEvent: (event: { event: string; data: unknown }) => void;
      }) => {
        emit = options.onEvent;
        return { stop: () => {} };
      },
    } as unknown as NonNullable<HerdrBackendOptions["client"]>;

    const backend = createHerdrBackend({ client });
    const sent: Record<string, unknown>[] = [];
    return {
      backend,
      sent,
      reads,
      keys,
      async open(sessionId: string) {
        backend.registerClient(sessionId, (msg) => sent.push(msg));
        await backend.listSessionDescriptors();
      },
      async report(paneId: string, status: string, agent?: string) {
        emit?.({
          event: "pane_updated",
          data: { pane: { pane_id: paneId, agent_status: status, ...(agent ? { agent } : {}) } },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    };
  }

  test("T1: idle claude trust dialog reaches the phone as agent_attention_notice", async () => {
    const h = attentionBackend({ screen: TRUST_DIALOG });
    await h.open("w3V:p1");
    await h.report("w3V:p1", "idle", "claude");
    const notices = h.sent.filter((msg) => msg.code === "agent_attention_notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      type: "error",
      code: "agent_attention_notice",
      sessionId: "w3V:p1",
    });
    expect(String(notices[0]?.message)).toContain("Quick safety check");
  });

  test("T2: idle with kind not yet detected still announces the dialog", async () => {
    const h = attentionBackend({ screen: TRUST_DIALOG });
    await h.open("w3V:p1");
    await h.report("w3V:p1", "idle");
    expect(h.sent.filter((msg) => msg.code === "agent_attention_notice")).toHaveLength(1);
  });

  test("T3: idle omp does not read the pane", async () => {
    const h = attentionBackend({ screen: TRUST_DIALOG });
    await h.open("w3V:p1");
    await h.report("w3V:p1", "idle", "omp");
    expect(h.reads).toHaveLength(0);
    expect(h.sent.filter((msg) => msg.code === "agent_attention_notice")).toHaveLength(0);
  });

  test("T4: ordinary idle claude Empty state reads once and sends no notice", async () => {
    const h = attentionBackend({ screen: IDLE_COMPOSER });
    await h.open("w3V:p1");
    await h.report("w3V:p1", "idle", "claude");
    expect(h.reads).toHaveLength(1);
    expect(h.sent.filter((msg) => msg.code === "agent_attention_notice")).toHaveLength(0);
  });

  test("T5: working claude does not read", async () => {
    const h = attentionBackend({ screen: TRUST_DIALOG });
    await h.open("w3V:p1");
    await h.report("w3V:p1", "working", "claude");
    expect(h.reads).toHaveLength(0);
    expect(h.sent.filter((msg) => msg.code === "agent_attention_notice")).toHaveLength(0);
  });

  test("T6: idle ledger is not cleared by working then idle again", async () => {
    const h = attentionBackend({ screen: TRUST_DIALOG });
    await h.open("p1");
    await h.report("p1", "idle", "claude");
    await h.report("p1", "working", "claude");
    await h.report("p1", "idle", "claude");
    expect(h.sent.filter((msg) => msg.code === "agent_attention_notice")).toHaveLength(1);
  });

  test("T8: missing paneRead on idle does not send keys; claude blocked Cancel still presses esc", async () => {
    const keys: { pane: string; keys: string[] }[] = [];
    const missing = attentionBackend({ screen: TRUST_DIALOG, paneRead: "missing", keys });
    await missing.open("p1");
    await missing.report("p1", "idle", "claude");
    expect(keys).toEqual([]);

    // H1: the unattended/user deny key for claude remains esc (native-permission.ts:255).
    let emit: ((event: { event: string; data: unknown }) => void) | undefined;
    const client = {
      call: async () => ({ type: "ok" }),
      agentGet: async () => ({ agent_status: "blocked" }),
      paneRead: async () => ({ text: BASH_PROMPT, revision: 1 }),
      paneSendText: async () => {},
      paneSendKeys: async (paneId: string, sent: string[]) => {
        keys.push({ pane: paneId, keys: sent });
      },
      subscribeEvents: async (options: {
        onEvent: (event: { event: string; data: unknown }) => void;
      }) => {
        emit = options.onEvent;
        return { stop: () => {} };
      },
    } as unknown as NonNullable<HerdrBackendOptions["client"]>;
    const backend = createHerdrBackend({ client });
    const sent: Record<string, unknown>[] = [];
    backend.registerClient("p1", (msg) => sent.push(msg));
    await backend.listSessionDescriptors();
    emit?.({
      event: "pane_updated",
      data: { pane: { pane_id: "p1", agent_status: "blocked", agent: "claude" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const request = sent.find((msg) => msg.type === "permission_request") as
      | { requestId: string }
      | undefined;
    expect(request?.requestId).toBeDefined();
    await backend.resolvePermission(request!.requestId, { allow: false });
    expect(keys).toEqual([{ pane: "p1", keys: ["esc"] }]);
  });
});

