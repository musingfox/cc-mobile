import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";
import { z } from "zod";
import type { AgentProfileSource } from "./agents/profiles";
import type { AuditLog } from "./audit/audit-log";
import { captureClientIdentity } from "./audit/client-identity";
import type { ServerConfig } from "./config";
import type { EventBuffer } from "./event-buffer";
import { handleTerminalCreate, sendPrompt, type TerminalControlBackend } from "./terminal-control";
import { bufferSessionEvent } from "./ws";

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
    registerClient(
      claudeUuid: string,
      sink: (msg: Record<string, unknown>) => void,
      owner?: unknown,
    ): void;
  };
  /** The WS transport's replay buffer, so a phone that connects later replays this pane's turn. */
  eventBuffer: EventBuffer;
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
          { claudeUuid: sessionId, content: parsed.data.prompt, ip, device: "launch-api" },
          () => reportedError,
        );
      } catch {
        set.status = 502;
        return { error: "prompt_failed", sessionId };
      }
      if (reportedError !== undefined) {
        set.status = 502;
        return { error: "prompt_failed", code: reportedError, sessionId };
      }
      set.status = 201;
      return { sessionId };
    },
  );
}
