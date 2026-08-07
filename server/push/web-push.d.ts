/**
 * Types for `web-push@3`, which ships none of its own.
 *
 * Only the surface cc-mobile uses is declared, which makes this file the
 * written-down contract of the transport seam: what `sender.ts` may pass and
 * what it may read back. Widen it deliberately, not by reflex.
 */
declare module "web-push" {
  export interface WebPushSubscription {
    endpoint: string;
    keys: Record<string, string>;
  }

  export interface WebPushVapidDetails {
    subject: string;
    publicKey: string;
    privateKey: string;
  }

  export interface WebPushRequestOptions {
    TTL?: number;
    urgency?: string;
    topic?: string;
    vapidDetails?: WebPushVapidDetails;
  }

  /** What a push service answers on success. */
  export interface WebPushSendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }

  /**
   * A non-2xx answer rejects with this shape — `statusCode` is what drives the
   * 410/404 pruning, `body` is where APNs puts its `reason`.
   */
  export class WebPushError extends Error {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    endpoint: string;
  }

  export function sendNotification(
    subscription: WebPushSubscription,
    payload?: string,
    options?: WebPushRequestOptions,
  ): Promise<WebPushSendResult>;

  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
}
