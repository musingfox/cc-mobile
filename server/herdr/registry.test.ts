/**
 * registry.test.ts — HerdrCreateSession + HerdrTeardown.
 *
 * Every case runs against a fake herdr client: no daemon, no socket. The
 * assertions that matter most are the exact `agent.start` params (the daemon
 * passes argv through verbatim, so this is the real claude command line) and
 * the failure path leaving nothing behind.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeUuidFromWorkspaceLabel,
  createHerdrRegistry,
  workspaceLabelFor,
} from "./registry";

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
    responseUrl: "http://127.0.0.1:3001/api/pty-response",
    // Instant, non-advancing clock: readiness must never make these tests wait.
    sleep: async () => {},
    now: () => 0,
  });
}

const writtenSettings = new Set<string>();

function trackSettings(path: string) {
  writtenSettings.add(path);
  return path;
}

afterEach(async () => {
  for (const path of writtenSettings) {
    try {
      if (existsSync(path)) await unlink(path);
    } catch {
      // ignore
    }
  }
  writtenSettings.clear();
});

describe("HerdrCreateSession", () => {
  test("launches via workspace.create → agent.start with the verbatim claude argv", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    const result = await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    trackSettings(result.settingsPath);

    expect(result.agentName).toBe("ccm-3f2a9b01");
    expect(result.paneId).toBe("p1");
    expect(result.settingsPath).toMatch(/ccm-settings-3f2a9b01-.*\.json$/);
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
      args: [
        "--permission-mode",
        "bypassPermissions",
        "--settings",
        result.settingsPath,
        "--session-id",
        UUID,
      ],
    });
    expect(registry.hasSession(UUID)).toEqual({ present: true, paneRef: "p1" });
  });

  test("rejects a duplicate claudeUuid before issuing any RPC", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    const first = await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    trackSettings(first.settingsPath);
    const callsAfterFirst = fake.calls.length;

    await expect(registry.createSession({ claudeUuid: UUID, cwd: "/tmp" })).rejects.toThrow(
      /already registered/,
    );
    expect(fake.calls.length).toBe(callsAfterFirst);
  });

  test("writes a settings file wiring the Stop hook to the response URL", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    const result = await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    trackSettings(result.settingsPath);

    const settings = JSON.parse(await readFile(result.settingsPath, "utf8"));
    const command = settings.hooks.Stop[0].hooks[0].command;
    expect(command).toContain("http://127.0.0.1:3001/api/pty-response");
    expect(command).toContain("pty-stop-hook.ts");

    // The hook path must resolve to a file that actually exists — a wrong
    // relative base would still satisfy the substring check above but would
    // break every reply at runtime.
    const hookPath = command.match(/bun '([^']+)'/)?.[1];
    expect(hookPath).toBeDefined();
    expect(existsSync(hookPath)).toBe(true);
  });

  test("cleans up the workspace and settings file when agent.start fails", async () => {
    const boom = new Error("agent.start exploded");
    const fake = makeFakeClient({
      "agent.start": async () => {
        throw boom;
      },
    });
    const registry = makeRegistry(fake);
    const settingsPath = trackSettings(join(tmpdir(), `ccm-settings-${UUID}.json`));

    const caught = await registry
      .createSession({ claudeUuid: UUID, cwd: "/tmp" })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(caught).toBe(boom);
    const closeCall = fake.calls.find((call) => call.method === "workspace.close");
    expect(closeCall?.params).toEqual({ workspace_id: "w1" });
    expect(existsSync(settingsPath)).toBe(false);
    expect(registry.hasSession(UUID)).toEqual({ present: false });
  });

  test("cleans up when the readiness gate never passes", async () => {
    const fake = makeFakeClient({}, async () => ({ interactive_ready: false }));
    const registry = createHerdrRegistry({
      client: fake.client,
      responseUrl: "http://127.0.0.1:3001/api/pty-response",
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
    const settingsPath = trackSettings(join(tmpdir(), `ccm-settings-${UUID}.json`));

    await expect(registry.createSession({ claudeUuid: UUID, cwd: "/tmp" })).rejects.toThrow(
      /interactive_ready/,
    );

    expect(fake.calls.some((call) => call.method === "workspace.close")).toBe(true);
    expect(existsSync(settingsPath)).toBe(false);
    expect(registry.hasSession(UUID)).toEqual({ present: false });
  });
});

describe("PersistentSessionLabel", () => {
  test("labels the workspace with the full lowercased uuid while the agent name stays 8 chars", async () => {
    const mixedCase = "3F2B8C1D-9E4A-4B6F-8C2D-1A5E7F9B0C3D";
    const lower = mixedCase.toLowerCase();
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    const result = await registry.createSession({ claudeUuid: mixedCase, cwd: "/tmp" });
    trackSettings(result.settingsPath);

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

describe("HerdrTeardown", () => {
  test("closes the workspace, unlinks settings and deregisters the uuid", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    const created = await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    trackSettings(created.settingsPath);

    const result = await registry.teardown(UUID);

    expect(result).toEqual({ killed: true });
    const closeCall = fake.calls.find((call) => call.method === "workspace.close");
    expect(closeCall?.params).toEqual({ workspace_id: "w1" });
    expect(existsSync(created.settingsPath)).toBe(false);
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

    const created = await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" });
    trackSettings(created.settingsPath);

    const result = await registry.teardown(UUID);

    expect(result).toEqual({ killed: true });
    expect(registry.hasSession(UUID)).toEqual({ present: false });
  });

  test("teardownAll closes every live workspace", async () => {
    const fake = makeFakeClient();
    const registry = makeRegistry(fake);

    trackSettings((await registry.createSession({ claudeUuid: UUID, cwd: "/tmp" })).settingsPath);
    trackSettings((await registry.createSession({ claudeUuid: UUID2, cwd: "/tmp" })).settingsPath);
    expect(registry.listSessions().length).toBe(2);

    await registry.teardownAll();

    const closeCalls = fake.calls.filter((call) => call.method === "workspace.close");
    expect(closeCalls.length).toBe(2);
    expect(registry.listSessions()).toEqual([]);
  });
});
