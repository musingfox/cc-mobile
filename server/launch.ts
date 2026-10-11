import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, readFile, readlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { Elysia } from "elysia";
import { z } from "zod";
import type { AgentProfile, AgentProfileSource } from "./agents/profiles";
import type { AuditLog } from "./audit/audit-log";
import { captureClientIdentity } from "./audit/client-identity";
import type { ServerConfig } from "./config";
import type { EventBuffer } from "./event-buffer";
import { writeLaunchBinding } from "./launch-binding";
import { cardKey, type LaunchQueue } from "./launch-queue";
import { composeLaunchPrompt } from "./launch-prompt";
import type { CardWorktrees } from "./launch-worktree";
import { expandPath, isWithinRoot, validateAllowedPath, validateCwd } from "./path-utils";
import type { TerminalSendOutcome } from "./terminal-backend";
import { handleTerminalCreate, sendPrompt, type TerminalControlBackend } from "./terminal-control";
import { bufferSessionEvent } from "./ws";

const LaunchBody = z.object({
  cwd: z.string().min(1),
  cardPath: z.string().min(1),
  vault: z.string().min(1),
  project: z
    .string()
    .regex(/^[A-Za-z0-9._-]+$/)
    .regex(/^[^.]/),
  profileId: z.string().optional(),
});

const MAX_SYMLINKS = 40;

const STATUS: Record<string, number> = {
  invalid_cwd: 400,
  path_not_allowed: 403,
  unknown_profile: 400,
  invalid_message: 400,
  terminal_error: 500,
  invalid_branch_name: 400,
  worktree_exists: 409,
  no_base_branch: 400,
  cwd_not_on_base: 400,
  worktree_failed: 500,
};

/**
 * Resolves `path` one component at a time with `lstat` and `readlink` only.
 * `realpath` opens what it resolves, so an outside target this process cannot
 * open or list would fail as "not found" instead of resolving to a path
 * containment can refuse. Search permission on each directory crossed is enough.
 * Throws when the path does not resolve.
 */
export async function resolveByLstat(path: string): Promise<{ path: string; stats: Stats }> {
  const pending = path.split("/").filter(Boolean);
  let resolved = "/";
  let stats = await lstat(resolved);
  let links = 0;
  while (pending.length > 0) {
    const name = pending.shift() as string;
    if (name === ".") continue;
    if (name === "..") {
      resolved = dirname(resolved);
      stats = await lstat(resolved);
      continue;
    }
    const next = join(resolved, name);
    const entry = await lstat(next);
    if (entry.isSymbolicLink()) {
      if (++links > MAX_SYMLINKS) throw new Error("too many symbolic links");
      const target = await readlink(next);
      if (isAbsolute(target)) resolved = "/";
      pending.unshift(...target.split("/").filter(Boolean));
      continue;
    }
    if (pending.length > 0 && !entry.isDirectory()) throw new Error("not a directory");
    resolved = next;
    stats = entry;
  }
  return { path: resolved, stats };
}

/** Hashing first makes the comparison length-independent as well as constant-time. */
function tokenMatches(presented: string, expected: string): boolean {
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

type Refusal = { status: number; body: Record<string, unknown> };

interface Checked {
  cwd: string;
  cardPath: string;
  vault: string;
  project: string;
  profileId: string | undefined;
  cardText: string;
  /** The profile list as it stood when the checks ran, handed to session creation unchanged. */
  snapshot: AgentProfile[];
}

type LaunchOutcome =
  | { ok: true; status: 201; body: Record<string, unknown> }
  | { ok: false; reason: string; status: number; body: Record<string, unknown> };

export function createLaunchPlugin(opts: {
  config: ServerConfig;
  backend: TerminalControlBackend & {
    send(params: {
      claudeUuid: string;
      content: string;
      confirmStart?: boolean;
    }): Promise<TerminalSendOutcome>;
    registerClient(
      claudeUuid: string,
      sink: (msg: Record<string, unknown>) => void,
      owner?: unknown,
    ): void;
  };
  /** The WS transport's replay buffer, so a phone that connects later replays this pane's turn. */
  eventBuffer: EventBuffer;
  agentProfiles: AgentProfileSource;
  /** Where the writeback hook reads card bindings from. */
  launchesDir: string;
  /** Each card gets its own worktree of the repo its cwd is in. */
  worktrees: CardWorktrees;
  /** Holds the hangar to its cap; a launch beyond it waits here. */
  queue: LaunchQueue;
  auditLog?: AuditLog;
}) {
  const audit = async (record: Parameters<AuditLog["append"]>[0]) => {
    try {
      await opts.auditLog?.append(record);
    } catch {}
  };

  /** Every check that writes nothing, in the order they have always run. */
  async function checkLaunch(
    body: unknown,
    vaultRoot: string,
  ): Promise<{ ok: true; checked: Checked } | ({ ok: false } & Refusal)> {
    const refuse = (status: number, error: string, message?: string) => ({
      ok: false as const,
      status,
      body: message === undefined ? { error } : { error, message },
    });
    const parsed = LaunchBody.safeParse(body);
    if (!parsed.success) return refuse(400, "invalid_body");
    const { cwd, cardPath, vault, project, profileId } = parsed.data;
    if (vault !== basename(vaultRoot)) return refuse(400, "vault_mismatch");
    if (isAbsolute(cardPath) || cardPath.split("/").includes("..") || !cardPath.endsWith(".md")) {
      return refuse(400, "invalid_card_path");
    }
    let card: { path: string; stats: Stats };
    let root: string;
    try {
      root = (await resolveByLstat(vaultRoot)).path;
      card = await resolveByLstat(join(vaultRoot, cardPath));
    } catch {
      return refuse(404, "card_not_found");
    }
    if (!isWithinRoot(card.path, root)) return refuse(403, "card_not_allowed");
    let cardText: string;
    try {
      if (!card.stats.isFile()) throw new Error("not a regular file");
      cardText = await readFile(card.path, "utf8");
    } catch {
      return refuse(404, "card_not_found");
    }
    // A binding is keyed by claude's session id, which no other kind reports.
    const snapshot = opts.agentProfiles.list();
    const profile = profileId ? snapshot.find(({ id }) => id === profileId) : undefined;
    if (profile && profile.kind !== "claude") return refuse(400, "unsupported_kind");
    // The terminal checks run again in handleTerminalCreate, but only after
    // the worktree exists; a refused cwd or profile must not leave one behind.
    const expandedCwd = expandPath(cwd);
    const cwdError = validateCwd(expandedCwd);
    if (cwdError) return refuse(400, "invalid_cwd", cwdError);
    if (!validateAllowedPath(expandedCwd, opts.config.allowedRoots)) {
      return refuse(403, "path_not_allowed", "Project path is not in the allowed roots");
    }
    if (profileId && !profile) {
      return refuse(400, "unknown_profile", `Unknown agent profile: ${profileId}`);
    }
    return { ok: true, checked: { cwd, cardPath, vault, project, profileId, cardText, snapshot } };
  }

  /** Everything a launch writes: worktree, pane, binding, sink and prompt. */
  async function runLaunch(checked: Checked, ip: string | null): Promise<LaunchOutcome> {
    const { cwd, cardPath, vault, project, profileId, cardText, snapshot } = checked;
    const fail = (
      reason: string,
      status: number,
      body: Record<string, unknown>,
    ): LaunchOutcome => ({ ok: false, reason, status, body });
    const worktree = await opts.worktrees.create({
      cwd,
      cardName: basename(cardPath, ".md"),
      allowedRoots: opts.config.allowedRoots,
    });
    if (worktree.kind === "refused") {
      return fail(worktree.code, STATUS[worktree.code], {
        error: worktree.code,
        message: worktree.message,
      });
    }
    const discardWorktree = async () => {
      if (worktree.kind === "created") await opts.worktrees.remove(worktree);
    };
    const claudeUuid = randomUUID();
    let reply: Record<string, unknown> = {};
    await handleTerminalCreate(
      { claudeUuid, cwd: worktree.kind === "created" ? worktree.cwd : cwd, profileId },
      {
        backend: {
          createSession: (input) => opts.backend.createSession({ ...input, side: "hangar" }),
          teardown: (key) => opts.backend.teardown(key),
        },
        allowedRoots: opts.config.allowedRoots,
        agentProfiles: { list: () => snapshot },
        send: (msg) => {
          reply = msg;
        },
      },
    );
    if (reply.type !== "terminal_created") {
      await discardWorktree();
      const code = String(reply.code);
      return fail(code, STATUS[code] ?? 500, { error: code, message: reply.message });
    }
    const sessionId = String(reply.sessionId);
    try {
      await writeLaunchBinding(opts.launchesDir, claudeUuid, {
        cardPath,
        vault,
        project,
        paneId: sessionId,
        createdAt: new Date().toISOString(),
      });
    } catch {
      await opts.backend.teardown(sessionId).catch(() => {});
      await discardWorktree();
      return fail("binding_failed", 500, { error: "binding_failed", sessionId, claudeUuid });
    }
    // Routing types nothing into a pane with no sink — so bind one, owned by
    // this launch alone. What it hears is for a phone's replay only: the
    // launch's answer is the send's own outcome.
    opts.backend.registerClient(
      sessionId,
      (event) => bufferSessionEvent(opts.eventBuffer, sessionId, event),
      {},
    );
    let outcome: TerminalSendOutcome | undefined;
    try {
      outcome = await sendPrompt(opts.backend, audit, {
        sessionId,
        content: composeLaunchPrompt(cardText),
        ip,
        device: "launch-api",
        confirmStart: true,
      });
    } catch {
      return fail("prompt_failed", 502, { error: "prompt_failed", sessionId, claudeUuid });
    }
    if (outcome?.ok !== true) {
      return fail("prompt_failed", 502, {
        error: "prompt_failed",
        code: outcome?.code,
        sessionId,
        claudeUuid,
      });
    }
    return { ok: true, status: 201, body: { sessionId, claudeUuid } };
  }

  return new Elysia().post(
    `${opts.config.basePath}/api/launch`,
    async ({ request, body, set, server }) => {
      const token = opts.config.launchToken;
      if (!token) {
        set.status = 503;
        return { error: "launch_disabled" };
      }
      const auth = request.headers.get("authorization") ?? "";
      if (!auth.startsWith("Bearer ") || !tokenMatches(auth.slice(7), token)) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (opts.config.hangarSession === null || opts.config.hangarSession === undefined) {
        set.status = 503;
        return { error: "hangar_unavailable" };
      }
      const vaultRoot = opts.config.vaultRoot;
      if (!vaultRoot) {
        set.status = 503;
        return { error: "vault_unconfigured" };
      }
      const first = await checkLaunch(body, vaultRoot);
      if (!first.ok) {
        set.status = first.status;
        return first.body;
      }
      const { cardPath, vault } = first.checked;
      const { ip } = captureClientIdentity({
        headers: request.headers,
        remoteAddress: server?.requestIP(request)?.address,
      });
      // The reply of a launch admitted at once is its own outcome; one that
      // waits answers 202 now and reports a failure only in the server log.
      let outcome: LaunchOutcome | undefined;
      const submitted = await opts.queue.submit({
        key: cardKey(vault, cardPath),
        label: `${vault}/${cardPath}`,
        start: async () => {
          const again = await checkLaunch(body, vaultRoot);
          outcome = again.ok
            ? await runLaunch(again.checked, ip)
            : {
                ok: false,
                reason: String(again.body.error),
                status: again.status,
                body: again.body,
              };
          return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
        },
      });
      switch (submitted.kind) {
        case "already_queued":
          set.status = 409;
          return { error: "already_queued" };
        case "hangar_offline":
          set.status = 503;
          return { error: "hangar_offline" };
        case "queued":
          set.status = 202;
          return { queued: true, position: submitted.position };
        case "started": {
          await submitted.outcome;
          if (!outcome) {
            set.status = 500;
            return { error: "unexpected_error" };
          }
          set.status = outcome.status;
          return outcome.body;
        }
      }
    },
  );
}
