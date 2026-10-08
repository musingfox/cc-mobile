import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { Elysia } from "elysia";
import { z } from "zod";
import type { AgentProfileSource } from "./agents/profiles";
import type { AuditLog } from "./audit/audit-log";
import { captureClientIdentity } from "./audit/client-identity";
import type { ServerConfig } from "./config";
import type { EventBuffer } from "./event-buffer";
import { writeLaunchBinding } from "./launch-binding";
import { composeLaunchPrompt } from "./launch-prompt";
import { validateAllowedPath } from "./path-utils";
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

const STATUS: Record<string, number> = {
  invalid_cwd: 400,
  path_not_allowed: 403,
  unknown_profile: 400,
  invalid_message: 400,
  terminal_error: 500,
};

/** Hashing first makes the comparison length-independent as well as constant-time. */
function tokenMatches(presented: string, expected: string): boolean {
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

export function createLaunchPlugin(opts: {
  config: ServerConfig;
  backend: TerminalControlBackend & {
    send(params: { claudeUuid: string; content: string }): Promise<void>;
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
  auditLog?: AuditLog;
}) {
  const audit = async (record: Parameters<AuditLog["append"]>[0]) => {
    try {
      await opts.auditLog?.append(record);
    } catch {}
  };
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
      const parsed = LaunchBody.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return { error: "invalid_body" };
      }
      const { cwd, cardPath, vault, project, profileId } = parsed.data;
      if (vault !== basename(vaultRoot)) {
        set.status = 400;
        return { error: "vault_mismatch" };
      }
      if (isAbsolute(cardPath) || cardPath.split("/").includes("..") || !cardPath.endsWith(".md")) {
        set.status = 400;
        return { error: "invalid_card_path" };
      }
      // Resolve before checking containment: validateAllowedPath compares a
      // path it cannot realpath lexically, which mismatches a symlinked root.
      let cardFile: string;
      try {
        cardFile = await realpath(join(vaultRoot, cardPath));
      } catch {
        set.status = 404;
        return { error: "card_not_found" };
      }
      if (!validateAllowedPath(cardFile, [vaultRoot])) {
        set.status = 403;
        return { error: "card_not_allowed" };
      }
      let card: string;
      try {
        card = await readFile(cardFile, "utf8");
      } catch {
        set.status = 404;
        return { error: "card_not_found" };
      }
      // A binding is keyed by claude's session id, which no other kind reports.
      const profile = profileId
        ? opts.agentProfiles.list().find(({ id }) => id === profileId)
        : undefined;
      if (profile && profile.kind !== "claude") {
        set.status = 400;
        return { error: "unsupported_kind" };
      }
      const claudeUuid = randomUUID();
      let reply: Record<string, unknown> = {};
      await handleTerminalCreate(
        { claudeUuid, cwd, profileId },
        {
          backend: {
            createSession: (input) => opts.backend.createSession({ ...input, side: "hangar" }),
            teardown: (key) => opts.backend.teardown(key),
          },
          allowedRoots: opts.config.allowedRoots,
          agentProfiles: opts.agentProfiles,
          send: (msg) => {
            reply = msg;
          },
        },
      );
      if (reply.type !== "terminal_created") {
        const code = String(reply.code);
        set.status = STATUS[code] ?? 500;
        return { error: code, message: reply.message };
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
        set.status = 500;
        return { error: "binding_failed", sessionId, claudeUuid };
      }
      const { ip } = captureClientIdentity({
        headers: request.headers,
        remoteAddress: server?.requestIP(request)?.address,
      });
      // Routing types nothing into a pane with no sink, and reports refusals
      // only to the sink — so bind one, owned by this launch alone.
      let reportedError: string | undefined;
      opts.backend.registerClient(
        sessionId,
        (event) => {
          if (event.type === "error" && reportedError === undefined) {
            reportedError = String(event.code);
          }
          bufferSessionEvent(opts.eventBuffer, sessionId, event);
        },
        {},
      );
      try {
        await sendPrompt(
          opts.backend,
          audit,
          { claudeUuid: sessionId, content: composeLaunchPrompt(card), ip, device: "launch-api" },
          () => reportedError,
        );
      } catch {
        set.status = 502;
        return { error: "prompt_failed", sessionId, claudeUuid };
      }
      if (reportedError !== undefined) {
        set.status = 502;
        return { error: "prompt_failed", code: reportedError, sessionId, claudeUuid };
      }
      set.status = 201;
      return { sessionId, claudeUuid };
    },
  );
}
