/**
 * sender.ts — the one place a push actually leaves this machine.
 *
 * The transport defaults to `web-push`'s `sendNotification`; `opts.send` exists
 * so a test can stand at that boundary without contacting Apple. It is a seam,
 * not an on-switch: with nothing injected the real request goes out. A dispatch
 * that cannot send says so — the attempt log never carries a status nobody
 * received.
 */

import webpush from "web-push";
import type { AttemptLog } from "./attempt-log";
import { createAttemptLog } from "./attempt-log";
import { buildPayload } from "./payload";

export interface PushSubscription {
  endpoint: string;
  keys: Record<string, string>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` — the push service contacts this if a send misbehaves. */
  subject?: string;
}

/** Exactly what goes on the wire per request. */
export interface PushRequestOptions {
  TTL: number;
  urgency: string;
  vapidDetails: { subject: string; publicKey: string; privateKey: string };
}

export type PushTransport = (
  sub: PushSubscription,
  payload: string,
  opts: PushRequestOptions,
) => Promise<{ statusCode?: number } | void>;

export interface PushSenderOptions {
  attemptLog?: AttemptLog;
  /** Transport boundary. Defaults to the real `web-push` request. */
  send?: PushTransport;
  store?: { remove(endpoint: string): void };
  /** Seconds a push service may hold the message. Clamped to ≥ 1 at use. */
  ttl?: { permission: number; turn: number };
  warn?: (message: string) => void;
}

export interface PushSendResult {
  attempted: number;
}

/** Used when the operator sets no `CC_MOBILE_VAPID_SUBJECT`. */
export const DEFAULT_VAPID_SUBJECT = "mailto:cc-mobile@localhost";

const DEFAULT_TTL = { permission: 90, turn: 300 };

export function createPushSender(opts: PushSenderOptions = {}) {
  const log = opts.attemptLog ?? createAttemptLog();
  const send: PushTransport =
    opts.send ?? ((sub, payload, options) => webpush.sendNotification(sub, payload, options));
  const store = opts.store;
  const ttlConfig = opts.ttl ?? DEFAULT_TTL;
  const warn = opts.warn ?? ((message: string) => console.warn(`[push] ${message}`));
  // Once per sender — one per process in production. A missing VAPID config is
  // a standing condition, and a line per settled turn would bury it.
  let warnedMissingVapid = false;

  async function dispatch(
    kind: "turn" | "permission",
    subs: PushSubscription[],
    vapid?: VapidConfig,
  ): Promise<PushSendResult> {
    if (!vapid || !vapid.publicKey || !vapid.privateKey) {
      if (!warnedMissingVapid) {
        warnedMissingVapid = true;
        warn(
          "no VAPID keys configured (CC_MOBILE_VAPID_PUBLIC_KEY / CC_MOBILE_VAPID_PRIVATE_KEY) — background push is disabled",
        );
      }
      return { attempted: 0 };
    }
    if (!subs || subs.length === 0) return { attempted: 0 };

    const payloadStr = JSON.stringify(buildPayload(kind));
    const configured = kind === "permission" ? ttlConfig.permission : ttlConfig.turn;
    const options: PushRequestOptions = {
      // A TTL of 0 means "deliver now or drop it", which for a phone that is
      // asleep — the whole point here — means drop it.
      TTL: Math.max(1, Math.floor(configured)),
      urgency: kind === "permission" ? "high" : "normal",
      vapidDetails: {
        subject: vapid.subject ?? DEFAULT_VAPID_SUBJECT,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    };

    let attempted = 0;
    for (const sub of subs) {
      let status: number | null = null;
      let reason: string | null = null;
      try {
        const result = await send(sub, payloadStr, options);
        // Read the service's own answer; a transport that reports none leaves
        // `status` null rather than being credited with a 201 it never got.
        const code = (result as { statusCode?: unknown } | undefined)?.statusCode;
        status = typeof code === "number" ? code : null;
      } catch (error: unknown) {
        const failure = (error ?? {}) as {
          statusCode?: unknown;
          body?: unknown;
          message?: unknown;
        };
        status = typeof failure.statusCode === "number" ? failure.statusCode : null;
        if (typeof failure.body === "string") {
          try {
            const parsed: unknown = JSON.parse(failure.body);
            const parsedReason =
              parsed && typeof parsed === "object"
                ? (parsed as { reason?: unknown }).reason
                : undefined;
            reason = typeof parsedReason === "string" ? parsedReason : failure.body;
          } catch {
            reason = failure.body;
          }
        } else if (typeof failure.message === "string") {
          reason = failure.message;
        } else {
          reason = String(error);
        }
      }
      // Each subscription is independent: one phone's expired registration
      // must not cost the others their notification.
      attempted++;
      if ((status === 410 || status === 404) && store) {
        store.remove(sub.endpoint);
      }
      await log.append({ kind, endpoint: sub.endpoint, status, reason });
    }
    return { attempted };
  }

  return { dispatch };
}
