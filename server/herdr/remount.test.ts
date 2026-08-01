/**
 * remount.test.ts — StartupRemount + OrphanPaneReap.
 *
 * Every fixture below is shaped from a live probe against herdr 0.7.5 /
 * protocol 17 (2026-08-01), not from memory: `session.snapshot` returns flat
 * `workspaces` / `panes` arrays, and `pane.process_info` nests its payload
 * under a `process_info` key with nullable `argv` / `argv0`. A fake client
 * speaking a dialect the daemon does not speak would let real wire bugs pass
 * green — the lesson from the `agent_started` ack in #22.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { settingsPathFor, workspaceLabelFor } from "./registry";
import { remountLiveSessions } from "./remount";
import { PaneProcessInfoResultSchema } from "./schema";

const UUID = "3f2b8c1d-9e4a-4b6f-8c2d-1a5e7f9b0c3d";
const UUID2 = "7c4d5e02-2222-4333-8444-555566667777";

// ── fixtures ─────────────────────────────────────────────────────────────────

function workspace(workspaceId: string, label: string) {
  return {
    workspace_id: workspaceId,
    label,
    number: 3,
    focused: false,
    active_tab_id: `${workspaceId}:t1`,
    tab_count: 1,
    pane_count: 1,
    agent_status: "idle",
  };
}

function pane(paneId: string, workspaceId: string, agent?: string) {
  return {
    pane_id: paneId,
    terminal_id: `term_${paneId}`,
    workspace_id: workspaceId,
    tab_id: `${workspaceId}:t1`,
    focused: false,
    agent_status: agent ? "working" : "unknown",
    revision: 412,
    ...(agent ? { agent } : {}),
    cwd: "/tmp/scratch",
  };
}

/** The argv cc-mobile's own agent.start produces, as the daemon reports it. */
function claudeProcess(sessionId: string) {
  return {
    pid: 4242,
    name: "2.1.220",
    argv0: "claude",
    argv: [
      "claude",
      "--permission-mode",
      "default",
      "--settings",
      settingsPathFor(sessionId),
      "--session-id",
      sessionId,
    ],
    cmdline: `claude --session-id ${sessionId}`,
    cwd: "/tmp/scratch",
  };
}

const shellProcess = {
  pid: 4200,
  name: "fish",
  argv0: "fish",
  argv: ["fish"],
  cmdline: "fish",
  cwd: "/tmp/scratch",
};

function snapshotResult(workspaces: unknown[], panes: unknown[]) {
  return {
    type: "session_snapshot",
    snapshot: {
      version: "0.7.5",
      protocol: 17,
      workspaces,
      tabs: [],
      panes,
      layouts: [],
      agents: [],
    },
  };
}

// ── fake client ──────────────────────────────────────────────────────────────

interface FakeOptions {
  workspaces: unknown[];
  panes: unknown[];
  /** pane_id → the foreground_processes that pane reports, or a thrown error. */
  processes: Record<string, unknown[] | Error>;
  /**
   * pane_id → per-call responses, consumed one per process_info call before
   * falling back to `processes`. Lets a test make the first call fail and the
   * retry succeed.
   */
  processSequence?: Record<string, (unknown[] | Error)[]>;
  closeFails?: boolean;
  snapshotFails?: boolean;
}

function makeFakeClient(options: FakeOptions) {
  const calls: { method: string; params: unknown }[] = [];

  const client = {
    call: async (method: string, params: unknown, schema?: { parse(v: unknown): unknown }) => {
      calls.push({ method, params });
      if (method === "session.snapshot") {
        if (options.snapshotFails) throw new Error("daemon gone");
        return parse(schema, snapshotResult(options.workspaces, options.panes));
      }
      if (method === "pane.process_info") {
        const paneId = (params as { pane_id: string }).pane_id;
        const queued = options.processSequence?.[paneId];
        const entry = queued?.length ? queued.shift() : options.processes[paneId];
        if (entry instanceof Error) throw entry;
        return parse(schema, {
          type: "pane_process_info",
          process_info: {
            pane_id: paneId,
            shell_pid: 4200,
            foreground_process_group_id: 4242,
            tty: "/dev/ttys011",
            foreground_processes: entry ?? [],
          },
        });
      }
      if (method === "workspace.close") {
        if (options.closeFails) throw new Error("close refused");
        return parse(schema, { type: "ok" });
      }
      throw new Error(`unexpected RPC ${method}`);
    },
  } as never;

  return {
    client: client as Parameters<typeof remountLiveSessions>[0]["client"],
    calls,
    closed: () =>
      calls.filter((call) => call.method === "workspace.close").map((call) => call.params),
    processInfoPanes: () =>
      calls
        .filter((call) => call.method === "pane.process_info")
        .map((call) => (call.params as { pane_id: string }).pane_id),
  };
}

/** Runs the payload through the caller's schema, exactly as the real client does. */
function parse(schema: { parse(value: unknown): unknown } | undefined, payload: unknown): unknown {
  return schema ? schema.parse(payload) : payload;
}

// ── harness ──────────────────────────────────────────────────────────────────

interface AdoptedEntry {
  claudeUuid: string;
  workspaceId: string;
  paneId: string;
  agentName: string;
  settingsPath: string;
}

function makeDeps(fake: ReturnType<typeof makeFakeClient>) {
  const registered = new Map<string, AdoptedEntry>();
  const subscribed: [string, string][] = [];
  const warnings: string[] = [];

  return {
    deps: {
      client: fake.client,
      adopt: (entry: AdoptedEntry) => {
        // Mirrors the real registry: a uuid already present is rejected, never
        // silently overwritten.
        if (registered.has(entry.claudeUuid)) {
          throw new Error(`already registered: ${entry.claudeUuid}`);
        }
        registered.set(entry.claudeUuid, entry);
      },
      subscribeStatus: async (claudeUuid: string, paneId: string) => {
        subscribed.push([claudeUuid, paneId]);
      },
      warn: (message: string) => warnings.push(message),
    },
    registered,
    subscribed,
    warnings,
  };
}

const settingsFiles = new Set<string>();

async function writeSettingsFile(claudeUuid: string): Promise<string> {
  const path = settingsPathFor(claudeUuid);
  await writeFile(path, "{}", "utf8");
  settingsFiles.add(path);
  return path;
}

afterEach(async () => {
  for (const path of settingsFiles) {
    try {
      if (existsSync(path)) await unlink(path);
    } catch {
      // ignore
    }
  }
  settingsFiles.clear();
});

// ── wire shape ───────────────────────────────────────────────────────────────

describe("pane.process_info wire shape", () => {
  test("parses the live payload, nesting and nullable argv included", () => {
    const live = {
      type: "pane_process_info",
      process_info: {
        pane_id: "wD:p1",
        shell_pid: 5455,
        foreground_process_group_id: 33502,
        tty: "/dev/ttys011",
        foreground_processes: [
          { pid: 33502, name: "2.1.220", argv0: "claude", argv: ["claude", "-c"] },
          { pid: 1, name: "?", argv0: null, argv: null },
        ],
      },
    };

    const parsed = PaneProcessInfoResultSchema.parse(live);

    expect(parsed.process_info.pane_id).toBe("wD:p1");
    expect(parsed.process_info.foreground_processes?.[0]?.argv).toEqual(["claude", "-c"]);
    expect(parsed.process_info.foreground_processes?.[1]?.argv).toBeNull();
  });
});

// ── StartupRemount ───────────────────────────────────────────────────────────

describe("StartupRemount", () => {
  test("adopts a labelled workspace whose pane still runs the matching claude", async () => {
    const fake = makeFakeClient({
      workspaces: [workspace("ws-1", workspaceLabelFor(UUID))],
      panes: [pane("pn-1", "ws-1", "claude")],
      processes: { "pn-1": [claudeProcess(UUID)] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report.adopted).toEqual([UUID]);
    expect(report.reaped).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(harness.registered.get(UUID)).toEqual({
      claudeUuid: UUID,
      workspaceId: "ws-1",
      paneId: "pn-1",
      agentName: "ccm-3f2b8c1d",
      settingsPath: settingsPathFor(UUID),
    });
    // The status subscription is restarted against the pane just discovered —
    // without this the adopted session routes prompts but shows no activity.
    expect(harness.subscribed).toEqual([[UUID, "pn-1"]]);
    expect(fake.closed()).toEqual([]);
  });

  test("leaves a legacy 8-char label entirely alone", async () => {
    const fake = makeFakeClient({
      workspaces: [workspace("ws-old", "ccm-3f2b8c1d")],
      panes: [pane("pn-old", "ws-old", "claude")],
      processes: { "pn-old": [claudeProcess(UUID)] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report).toEqual({ adopted: [], reaped: [], skipped: [] });
    expect(fake.closed()).toEqual([]);
    // Not even probed: an unidentifiable label is not a candidate at all.
    expect(fake.processInfoPanes()).toEqual([]);
    expect(harness.registered.size).toBe(0);
  });

  test("skips a live claude whose --session-id contradicts the label", async () => {
    const fake = makeFakeClient({
      workspaces: [workspace("ws-1", workspaceLabelFor(UUID))],
      panes: [pane("pn-1", "ws-1", "claude")],
      // A claude is running, but it is someone else's session.
      processes: { "pn-1": [claudeProcess(UUID2)] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report.adopted).toEqual([]);
    expect(report.reaped).toEqual([]);
    expect(report.skipped.map((entry) => entry.uuid)).toEqual([UUID]);
    // The decisive assertion: a live claude is never closed, whoever owns it.
    expect(fake.closed()).toEqual([]);
    expect(harness.warnings.length).toBe(1);
  });

  test("skips a candidate only after pane.process_info rejects twice", async () => {
    const fake = makeFakeClient({
      workspaces: [workspace("ws-1", workspaceLabelFor(UUID))],
      panes: [pane("pn-1", "ws-1", "claude")],
      processes: { "pn-1": new Error("pane vanished") },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report.adopted).toEqual([]);
    expect(report.reaped).toEqual([]);
    expect(report.skipped[0]?.uuid).toBe(UUID);
    expect(report.skipped[0]?.reason).toContain("pane vanished");
    expect(fake.closed()).toEqual([]);
    // The retry happened: a skip costs two probes, never one.
    expect(fake.processInfoPanes()).toEqual(["pn-1", "pn-1"]);
  });

  test("adopts when a transient process_info failure clears on the retry", async () => {
    const fake = makeFakeClient({
      workspaces: [workspace("ws-1", workspaceLabelFor(UUID))],
      panes: [pane("pn-1", "ws-1", "claude")],
      processes: {},
      processSequence: { "pn-1": [new Error("daemon busy"), [claudeProcess(UUID)]] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    // One blip does not demote a live session to "unknown".
    expect(report.adopted).toEqual([UUID]);
    expect(report.skipped).toEqual([]);
    expect(fake.processInfoPanes()).toEqual(["pn-1", "pn-1"]);
    expect(harness.registered.get(UUID)?.paneId).toBe("pn-1");
  });

  test("adopts the first of two workspaces claiming one uuid and skips the duplicate", async () => {
    const fake = makeFakeClient({
      workspaces: [
        workspace("ws-1", workspaceLabelFor(UUID)),
        workspace("ws-dup", workspaceLabelFor(UUID)),
      ],
      panes: [pane("pn-1", "ws-1", "claude"), pane("pn-dup", "ws-dup", "claude")],
      processes: { "pn-1": [claudeProcess(UUID)], "pn-dup": [claudeProcess(UUID)] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report.adopted).toEqual([UUID]);
    expect(report.skipped.map((entry) => entry.uuid)).toEqual([UUID]);
    expect(harness.registered.get(UUID)?.paneId).toBe("pn-1");
    // A duplicate is an ambiguity to report, never a reason to close a pane.
    expect(fake.closed()).toEqual([]);
    expect(harness.subscribed).toEqual([[UUID, "pn-1"]]);
  });

  test("an unreadable snapshot rejects rather than starting with an empty registry", async () => {
    const fake = makeFakeClient({
      workspaces: [],
      panes: [],
      processes: {},
      snapshotFails: true,
    });
    const harness = makeDeps(fake);

    await expect(remountLiveSessions(harness.deps)).rejects.toThrow(/daemon gone/);
  });

  test("ignores workspaces this server never labelled", async () => {
    const fake = makeFakeClient({
      workspaces: [workspace("wD", "cyris"), workspace("wT", "")],
      panes: [pane("wD:p1", "wD", "claude")],
      processes: {},
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report).toEqual({ adopted: [], reaped: [], skipped: [] });
    expect(fake.processInfoPanes()).toEqual([]);
  });
});

// ── OrphanPaneReap ───────────────────────────────────────────────────────────

describe("OrphanPaneReap", () => {
  test("closes the workspace and unlinks settings when no claude is left", async () => {
    const settingsPath = await writeSettingsFile(UUID);
    const fake = makeFakeClient({
      workspaces: [workspace("ws-2", workspaceLabelFor(UUID))],
      panes: [pane("pn-2", "ws-2")],
      processes: { "pn-2": [shellProcess] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report.reaped).toEqual([UUID]);
    expect(report.adopted).toEqual([]);
    expect(fake.closed()).toEqual([{ workspace_id: "ws-2" }]);
    expect(existsSync(settingsPath)).toBe(false);
    // A reaped session is gone, not registered as routable.
    expect(harness.registered.size).toBe(0);
    expect(harness.subscribed).toEqual([]);
  });

  test("a refused workspace.close does not cost the rest of the batch its remount", async () => {
    const fake = makeFakeClient({
      workspaces: [
        workspace("ws-2", workspaceLabelFor(UUID)),
        workspace("ws-1", workspaceLabelFor(UUID2)),
      ],
      panes: [pane("pn-2", "ws-2"), pane("pn-1", "ws-1", "claude")],
      processes: { "pn-2": [shellProcess], "pn-1": [claudeProcess(UUID2)] },
      closeFails: true,
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report.reaped).toEqual([UUID]);
    expect(report.adopted).toEqual([UUID2]);
    expect(harness.registered.get(UUID2)?.paneId).toBe("pn-1");
  });

  test("skips rather than reaps when every argv is unreadable", async () => {
    const settingsPath = await writeSettingsFile(UUID);
    const fake = makeFakeClient({
      workspaces: [workspace("ws-2", workspaceLabelFor(UUID))],
      panes: [pane("pn-2", "ws-2")],
      // A daemon that cannot inspect a process it does not own reports a live
      // claude exactly like this — reaping here would kill the conversation.
      processes: { "pn-2": [{ pid: 9, name: "?", argv: null, argv0: null }] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report.reaped).toEqual([]);
    expect(report.skipped[0]?.uuid).toBe(UUID);
    expect(report.skipped[0]?.reason).toContain("no readable argv");
    expect(fake.closed()).toEqual([]);
    expect(existsSync(settingsPath)).toBe(true);
  });

  test("an empty foreground_processes list is no proof either — skip, not reap", async () => {
    const fake = makeFakeClient({
      workspaces: [workspace("ws-2", workspaceLabelFor(UUID))],
      panes: [pane("pn-2", "ws-2")],
      processes: { "pn-2": [] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report.reaped).toEqual([]);
    expect(report.skipped[0]?.uuid).toBe(UUID);
    expect(fake.closed()).toEqual([]);
  });

  test("one readable non-claude argv beside an unreadable one still reaps", async () => {
    const fake = makeFakeClient({
      workspaces: [workspace("ws-2", workspaceLabelFor(UUID))],
      panes: [pane("pn-2", "ws-2")],
      // The shell is readable and is not claude: positive evidence the claude
      // exited, so the unreadable straggler does not block the reap.
      processes: { "pn-2": [{ pid: 9, name: "?", argv: null, argv0: null }, shellProcess] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    expect(report.reaped).toEqual([UUID]);
    expect(fake.closed()).toEqual([{ workspace_id: "ws-2" }]);
  });

  test("reaps a claude launched by absolute path only when its session-id matches", async () => {
    const absolute = {
      pid: 77,
      name: "2.1.220",
      argv0: "/opt/homebrew/bin/claude",
      argv: ["/opt/homebrew/bin/claude", "--session-id", UUID],
      cmdline: "claude",
    };
    const fake = makeFakeClient({
      workspaces: [workspace("ws-1", workspaceLabelFor(UUID))],
      panes: [pane("pn-1", "ws-1", "claude")],
      processes: { "pn-1": [absolute] },
    });
    const harness = makeDeps(fake);

    const report = await remountLiveSessions(harness.deps);

    // basename matching keeps a path-invoked claude out of the reap branch.
    expect(report.adopted).toEqual([UUID]);
    expect(fake.closed()).toEqual([]);
  });
});
