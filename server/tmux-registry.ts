/**
 * tmux-registry.ts — C-hybrid TmuxRegistry: cc-mobile-owned tmux session + claude with injected hooks.
 *
 * - Spawns `tmux new-session -d -s ccm-<claudeUuid>` running claude (or dummy) with --settings pointing
 *   at a temp file containing Stop + PreToolUse hooks wired to loopback pty-* endpoints.
 * - Pure settings builder (SettingsInjection contract) extracted for testability.
 * - Injectable runCommand + claudeBin for hermetic tests.
 * - has / lookup (via has) / teardown.
 * - Does not modify SessionManager or PtyOrchestrator.
 *
 * Reuses pty-stop-hook.ts + pty-permission-hook.ts + pty-response-relay/endpoint verbatim (url shape).
 */

import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BuildClaudeSettingsInput {
  responseUrl: string;
  stopHookPath: string;
  permissionUrl?: string;
  permissionHookPath?: string;
}

export interface TmuxRegistryOptions {
  /** Injectable runner for tmux/claude invocations (default: Bun.spawn based). */
  runCommand?: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) => Promise<RunResult>;
  /** Path to claude binary (default: Bun.which('claude') || 'claude'). For tests: 'sleep'. */
  claudeBin?: string;
  /** Full URL for Stop hook POST target (e.g. http://127.0.0.1:3001/cc/api/pty-response). */
  responseUrl?: string;
  /** Full URL for PreToolUse hook POST target. */
  permissionUrl?: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CreateSessionInput {
  claudeUuid: string;
  cwd: string;
}

export interface CreateSessionResult {
  tmuxName: string;
  panePid: number;
  settingsPath: string;
}

export interface HasSessionResult {
  present: boolean;
  panePid?: number;
}

export interface TeardownResult {
  killed: boolean;
}

interface InternalEntry {
  tmuxName: string;
  panePid: number;
  settingsPath: string;
}

// ── Pure SettingsInjection (contract) ────────────────────────────────────────

/**
 * Generates the ~/.claude/settings.json (or --settings file) shape that wires
 * the Stop and PreToolUse hooks using the CC_MOBILE_*_URL env + bun <hook> shape.
 *
 * Throws if responseUrl is falsy (per T3).
 */
export function buildClaudeSettings(input: BuildClaudeSettingsInput): {
  hooks: {
    Stop: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
    PreToolUse?: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
  };
} {
  if (!input.responseUrl || input.responseUrl.trim() === "") {
    throw new Error("responseUrl is required and must be non-empty");
  }

  const stopCommand = `CC_MOBILE_RESPONSE_URL='${input.responseUrl}' bun '${input.stopHookPath}'`;

  const result: any = {
    hooks: {
      Stop: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: stopCommand,
            },
          ],
        },
      ],
    },
  };

  return result;
}

// ── Default runner ───────────────────────────────────────────────────────────

async function defaultRunCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts.cwd,
    env: opts.env ?? (process.env as any),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

// ── Registry factory ─────────────────────────────────────────────────────────

export function createTmuxRegistry(options: TmuxRegistryOptions = {}) {
  const run = options.runCommand ?? defaultRunCommand;
  const claudeBin = options.claudeBin ?? (Bun.which("claude") || "claude");
  const responseUrl = options.responseUrl ?? "http://127.0.0.1:3001/api/pty-response";
  const permissionUrl = options.permissionUrl ?? "http://127.0.0.1:3001/api/pty-permission";

  const STOP_HOOK_PATH = join(import.meta.dir, "pty-stop-hook.ts");
  const PERM_HOOK_PATH = join(import.meta.dir, "pty-permission-hook.ts");

  const sessions = new Map<string, InternalEntry>();

  async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const { claudeUuid, cwd } = input;

    if (sessions.has(claudeUuid)) {
      throw new Error(`already registered: ${claudeUuid}`);
    }

    const tmuxName = `ccm-${claudeUuid}`;

    // Build injected settings (pure)
    const settingsObj = buildClaudeSettings({
      responseUrl,
      stopHookPath: STOP_HOOK_PATH,
      permissionUrl,
      permissionHookPath: PERM_HOOK_PATH,
    });

    // Unique settings file per claudeUuid (tmpdir for hermetic + no root req)
    const settingsPath = join(tmpdir(), `ccm-settings-${claudeUuid}.json`);
    await writeFile(settingsPath, JSON.stringify(settingsObj, null, 2), "utf8");

    // Determine inner command. For tests passing claudeBin='sleep' we run `sleep 300`
    // so the tmux session stays up without requiring a real claude binary or hanging.
    const inner: string[] =
      claudeBin === "sleep" || claudeBin.endsWith("/sleep")
        ? ["sleep", "300"]
        : [
            claudeBin,
            "--permission-mode",
            "bypassPermissions",
            "--settings",
            settingsPath,
            "--session-id",
            claudeUuid,
          ];

    // Launch: detached tmux session owned by cc-mobile, cwd respected, hooks via --settings
    const tmuxNewArgs = ["new-session", "-d", "-s", tmuxName, "-c", cwd, "--", ...inner];
    const newRes = await run("tmux", tmuxNewArgs, { cwd });
    if (newRes.code !== 0) {
      // cleanup settings on failure
      try {
        await unlink(settingsPath);
      } catch {}
      throw new Error(`tmux new-session failed: ${newRes.stderr || newRes.stdout}`);
    }

    // Obtain pane_pid of the (sole) pane
    const listRes = await run("tmux", ["list-panes", "-t", tmuxName, "-F", "#{pane_pid}"], { cwd });
    if (listRes.code !== 0) {
      // best effort kill
      try {
        await run("tmux", ["kill-session", "-t", tmuxName]);
      } catch {}
      try {
        await unlink(settingsPath);
      } catch {}
      throw new Error(`tmux list-panes failed: ${listRes.stderr || listRes.stdout}`);
    }
    const panePid = parseInt(listRes.stdout.trim(), 10);
    if (!panePid || Number.isNaN(panePid)) {
      try {
        await run("tmux", ["kill-session", "-t", tmuxName]);
      } catch {}
      try {
        await unlink(settingsPath);
      } catch {}
      throw new Error(`failed to parse pane_pid from tmux: ${listRes.stdout}`);
    }

    const entry: InternalEntry = { tmuxName, panePid, settingsPath };
    sessions.set(claudeUuid, entry);

    return { tmuxName, panePid, settingsPath };
  }

  function listSessions(): string[] {
    return [...sessions.keys()];
  }

  function hasSession(claudeUuid: string): HasSessionResult {
    const entry = sessions.get(claudeUuid);
    if (!entry) {
      return { present: false };
    }
    return { present: true, panePid: entry.panePid };
  }

  async function teardown(claudeUuid: string): Promise<TeardownResult> {
    const entry = sessions.get(claudeUuid);
    if (!entry) {
      return { killed: false };
    }

    // Kill tmux (idempotent on our side; tmux kill is safe if gone)
    try {
      await run("tmux", ["kill-session", "-t", entry.tmuxName]);
    } catch {
      // ignore — may already be dead; we still deregister
    }

    // Remove settings file (no waiting on hooks)
    try {
      if (existsSync(entry.settingsPath)) {
        await unlink(entry.settingsPath);
      }
    } catch {
      // ignore
    }

    sessions.delete(claudeUuid);
    return { killed: true };
  }

  async function teardownAll(): Promise<void> {
    // Iterate a snapshot of keys; teardown mutates the map. No polling timer involved.
    for (const claudeUuid of [...sessions.keys()]) {
      await teardown(claudeUuid);
    }
  }

  return {
    createSession,
    listSessions,
    hasSession,
    teardown,
    teardownAll,
    // internal for debug if needed, but not required by contracts
    _sessions: sessions,
  };
}
