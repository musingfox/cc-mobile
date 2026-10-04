import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";
import { z } from "zod";
import type { AgentProfileSource } from "./agents/profiles";
import type { AuditLog } from "./audit/audit-log";
import { captureClientIdentity } from "./audit/client-identity";
import type { ServerConfig } from "./config";
import { handleTerminalCreate, sendPrompt, type TerminalControlBackend } from "./terminal-control";

const LaunchBody = z.object({
  cwd: z.string().min(1),
  prompt: z.string().min(1),
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
  };
  agentProfiles: AgentProfileSource;
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
      const parsed = LaunchBody.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return { error: "invalid_body" };
      }
      let reply: Record<string, unknown> = {};
      await handleTerminalCreate(
        { claudeUuid: randomUUID(), cwd: parsed.data.cwd, profileId: parsed.data.profileId },
        {
          backend: opts.backend,
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
      const { ip } = captureClientIdentity({
        headers: request.headers,
        remoteAddress: server?.requestIP(request)?.address,
      });
      try {
        await sendPrompt(opts.backend, audit, {
          claudeUuid: sessionId,
          content: parsed.data.prompt,
          ip,
          device: "launch-api",
        });
      } catch {
        set.status = 502;
        return { error: "prompt_failed", sessionId };
      }
      set.status = 201;
      return { sessionId };
    },
  );
}
