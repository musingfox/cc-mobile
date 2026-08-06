/**
 * registry.test.ts — HerdrCreateSession + HerdrTeardown + SelfLaunchNativeArgv.
 *
 * Every case runs against a fake herdr client: no daemon, no socket. The
 * assertions that matter most are the exact `agent.start` params (the daemon
 * passes argv through verbatim, so this is the real claude command line) and
 * the failure path leaving nothing behind.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeUuidFromWorkspaceLabel, createHerdrRegistry, workspaceLabelFor } from "./registry";

const UUID = "3f2a9b01-1111-4222-8333-444455556666";
const UUID2 = "7c4d5e02-2222-4333-8444-555566667777";

interface RecordedCall {
  method: string;
  params: unknown;
}

function makeFakeClient(
  overrides: Record<string, (params: unknown) => Promise<unknown>> = {},
  agentGet: () => Promise<{ interactive_ready?: boolean }> = async () => ({
    interactive_ready: true,
  }),
) {
  const calls: RecordedCall[] = [];
  const client = {
    call: (async (method: string, params: unknown) => {
      calls.push({ method, params });
      const override = overrides[method];
      if (override) return override(params);
      switch (method) {
        case "workspace.create":
          return {
            type: "workspace_created",
            workspace: { workspace_id: "w1" },
            root_pane: { pane_id: "p1" },
          };
        // Real wire shape (probe 2026-08-01): agent.start acks "agent_started".
        // The fake must speak the daemon's dialect or schema bugs slip through.
        case "agent.start":
          return { type: "agent_started" };
        default:
          return { type: "ok" };
      }
    }) as never,
    agentGet,
  };
  return { client, calls, methods: () => calls.map((call) => call.method) };
}

function makeRegistry(fake: ReturnType<typeof makeFakeClient>) {
  return createHerdrRegistry({
    client: fake.client,
    // Instant, non-advancing clock: readiness must never make these tests wait.
    sleep: async () => {},
    now: () => 0,
  });
}

/** The path the deleted hook pipeline used to write a per-uuid settings file to. */
function formerSettingsPath(claudeUuid: string): string {
  return join(tmpdir(), `ccm-settings-${claudeUuid}.json`);
}

describe("HerdrCreateSession", () => {
  test("launches via workspace.create → agent.start with the verbatim claude argv", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    const result = await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    expect(result.agentName).toBe("ccm-3f2a9b01");
    expect(result.paneId).toBe("p1");
    // The result carries no settings path any more: there is no settings file.
    expect(Object.keys(result).sort()).toEqual(["agentName", "paneId"]);
    // herdr rejects agent names longer than 32 chars.
    expect(result.agentName.length).toBeLessThanOrEqual(32);

    expect(fake.methods()).toEqual(["workspace.create", "agent.start"]);
    expect(fake.calls[0]?.params).toEqual({
      label: `ccm-${UUID}`,
      cwd: "/tmp",
      focus: false,
    });
    expect(fake.calls[1]?.params).toEqual({
      name: "ccm-3f2a9b01",
      kind: "claude",
      pane_id: "p1",
      // A plain claude: no --settings, therefore no cc-mobile hooks. Replies
      // come from the transcript and permissions from the pane's own screen,
      // which is what makes this session indistinguishable from one the user
      // started in their own terminal (Decision M6).
      args: ["--permission-mode", "default", "--session-id", UUID],
    });
    expect(registry.hasSession(UUID)).toEqual({ present: true, paneRef: "p1" });
  });

  test("agentKind:'omp' launches kind omp with no argv at all", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    await registry.createSession({ claudeUuid: UUID, cwd: "/tmp", agentKind: "omp" });

    // --permission-mode / --session-id are claude's flags; omp would die on
    // them. Live probe 2026-08-06: args:[] acks with argv:["omp"].
    expect(fake.calls[1]?.params).toEqual({
      name: "ccm-3f2a9b01",
      kind: "omp",
      pane_id: "p1",
      args: [],
    });
  });

  test("an absent agentKind still launches claude with its full argv", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    // What every PWA bundle cached before #31 sends.
    await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    expect((fake.calls[1]?.params as { kind: string }).kind).toBe("claude");
    expect((fake.calls[1]?.params as { args: string[] }).args).toEqual([
      "--permission-mode",
      "default",
      "--session-id",
      UUID,
    ]);
  });

  test("writes no settings file anywhere", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    expect(existsSync(formerSettingsPath(UUID))).toBe(false);
  });

  test("options.permissionMode overrides the argv value", async () => {
    const fake = makeFakeClient();
    const registry = createHerdrRegistry({
      client: fake.client,
      permissionMode: "plan",
      sleep: async () => {},
      now: () => 0,
    });

    await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    const startParams = fake.calls[1]?.params as { args: string[] };
    const pmIdx = startParams.args.indexOf("--permission-mode");
    expect(pmIdx).toBeGreaterThanOrEqual(0);
    expect(startParams.args[pmIdx + 1]).toBe("plan");
  });

  test("rejects a duplicate claudeUuid before issuing any RPC", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    const callsAfterFirst = fake.calls.length;

    await expect(registry.createSession({ claudeUuid: UUID, cwd: "/tmp" })).rejects.toThrow(
      /already registered/,
    );
    expect(fake.calls.length).toBe(callsAfterFirst);
  });

  test("closes the workspace when agent.start fails, with nothing to unlink", async () => {
    const boom = new Error("agent.start exploded");
    const fake = makeFakeClient({
      "agent.start": async () => {
        throw boom;
      },
    });
    const registry = makeRegistry(fake);

    const caught = await registry
      .createSession({ claudeUuid: UUID, cwd: "/tmp" })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(caught).toBe(boom);
    const closeCall = fake.calls.find((call) => call.method === "workspace.close");
    expect(closeCall?.params).toEqual({ workspace_id: "w1" });
    expect(existsSync(formerSettingsPath(UUID))).toBe(false);
    expect(registry.hasSession(UUID)).toEqual({ present: false });
  });

  test("cleans up when the readiness gate never passes", async () => {
    const fake = makeFakeClient({}, async () => ({ interactive_ready: false }));
    const registry = createHerdrRegistry({
      client: fake.client,
      readinessBudgetMs: 900,
      readinessPollMs: 300,
      sleep: async () => {},
      now: (() => {
        let current = 0;
        return () => {
          current += 300;
          return current;
        };
      })(),
    });

    await expect(registry.createSession({ claudeUuid: UUID, cwd: "/tmp" })).rejects.toThrow(
      /interactive_ready/,
    );

    expect(fake.calls.some((call) => call.method === "workspace.close")).toBe(true);
    expect(registry.hasSession(UUID)).toEqual({ present: false });
  });
});

describe("PersistentSessionLabel", () => {
  test("labels the workspace with the full lowercased uuid while the agent name stays 8 chars", async () => {
    const mixedCase = "3F2B8C1D-9E4A-4B6F-8C2D-1A5E7F9B0C3D";
    const lower = mixedCase.toLowerCase();
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    await registry.createSession({ claudeUuid: mixedCase, cwd: "/tmp" });

    const createParams = fake.calls[0]?.params as { label: string };
    expect(createParams.label).toBe(`ccm-${lower}`);
    // 4 chars of prefix + a 36-char uuid: the persistence key, verified on live
    // herdr. The agent name cannot carry this — herdr caps names at 32.
    expect(createParams.label.length).toBe(40);

    const startParams = fake.calls[1]?.params as { name: string };
    expect(startParams.name).toBe("ccm-3f2b8c1d");
    expect(startParams.name.length).toBeLessThanOrEqual(32);
  });

  test("the label round-trips back to the uuid, and legacy 8-char labels do not", () => {
    expect(claudeUuidFromWorkspaceLabel(workspaceLabelFor(UUID))).toBe(UUID);
    expect(claudeUuidFromWorkspaceLabel("ccm-3f2a9b01")).toBeUndefined();
    expect(claudeUuidFromWorkspaceLabel("cyris")).toBeUndefined();
    expect(claudeUuidFromWorkspaceLabel(`ccm-${UUID.toUpperCase()}`)).toBeUndefined();
  });
});

describe("adoptSession", () => {
  const entry = {
    claudeUuid: UUID,
    workspaceId: "ws-1",
    paneId: "pn-1",
    agentName: "ccm-3f2a9b01",
  };

  test("registers a pane this process did not create, issuing no RPC", () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    registry.adoptSession(entry);

    expect(registry.hasSession(UUID)).toEqual({ present: true, paneRef: "pn-1" });
    expect(registry.resolvePane(UUID)).toBe("pn-1");
    expect(registry.listSessions()).toEqual([UUID]);
    expect(registry.lookup(UUID)?.paneId).toBe("pn-1");
    // Adoption reads state that already exists; it must not touch the daemon.
    expect(fake.calls).toEqual([]);
  });

  test("rejects a duplicate uuid with the same error createSession raises", () => {
    const registry = makeRegistry(makeFakeClient());
    registry.adoptSession(entry);

    expect(() => registry.adoptSession({ ...entry, paneId: "pn-other" })).toThrow(
      /already registered/,
    );
    // The first registration wins; the loser never overwrites it.
    expect(registry.resolvePane(UUID)).toBe("pn-1");
  });

  test("an adopted session tears down like any other", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);
    registry.adoptSession(entry);

    const result = await registry.teardown(UUID);

    expect(result).toEqual({ killed: true });
    expect(fake.calls.find((call) => call.method === "workspace.close")?.params).toEqual({
      workspace_id: "ws-1",
    });
    expect(registry.hasSession(UUID)).toEqual({ present: false });
  });
});

describe("HerdrTeardown", () => {
  test("closes the workspace and deregisters the uuid", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    const result = await registry.teardown(UUID);

    expect(result).toEqual({ killed: true });
    const closeCall = fake.calls.find((call) => call.method === "workspace.close");
    expect(closeCall?.params).toEqual({ workspace_id: "w1" });
    expect(registry.hasSession(UUID)).toEqual({ present: false });
  });

  test("an unknown uuid is idempotent and issues no RPC", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    const result = await registry.teardown("ghost");

    expect(result).toEqual({ killed: false });
    expect(fake.calls).toEqual([]);
  });

  test("still deregisters when workspace.close rejects", async () => {
    const fake = makeFakeClient({
      "workspace.close": async () => {
        throw new Error("daemon gone");
      },
    });
    const registry = makeRegistry(fake);

    await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });

    const result = await registry.teardown(UUID);

    expect(result).toEqual({ killed: true });
    expect(registry.hasSession(UUID)).toEqual({ present: false });
  });

  test("teardownAll closes every live workspace", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    await registry.createSession({ claudeUuid: UUID2, cwd: "/tmp" });
    expect(registry.listSessions().length).toBe(2);

    await registry.teardownAll();

    const closeCalls = fake.calls.filter((call) => call.method === "workspace.close");
    expect(closeCalls.length).toBe(2);
    expect(registry.listSessions()).toEqual([]);
  });
});
