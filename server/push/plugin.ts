import { Elysia } from "elysia";
import { z } from "zod";
import type { ServerConfig } from "../config";
import {
  createSubscriptionStore,
  isAllowedPushEndpoint,
  type StoredSubscription,
} from "./subscription-store";
import { loadVapidKeys } from "./vapid";

const SubSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export interface PushPluginOptions {
  store?: ReturnType<typeof createSubscriptionStore>;
  config?: ServerConfig;
}

export function createPushPlugin(opts: PushPluginOptions = {}) {
  const store = opts.store ?? createSubscriptionStore();
  const base = (opts.config?.basePath ?? "") || "";

  return new Elysia({ prefix: base ? undefined : "" })
    .post(`${base}/api/push/subscribe`, async ({ body, set }) => {
      const parsed = SubSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return { error: "invalid_subscription" };
      }
      const sub = parsed.data as StoredSubscription;
      // The same predicate the store enforces, so a body the route accepts is
      // never silently dropped underneath it (and vice versa).
      if (!isAllowedPushEndpoint(sub.endpoint)) {
        set.status = 400;
        return { error: "endpoint_not_allowed" };
      }
      if (!store.add(sub)) {
        // Past the allowlist, the only way to fail is the write itself.
        set.status = 500;
        return { error: "store_write_failed" };
      }
      set.status = 201;
      return { ok: true };
    })
    .get(`${base}/api/push/public-key`, ({ set }) => {
      const v = loadVapidKeys();
      if (!v) {
        set.status = 503;
        return { error: "push_not_configured" };
      }
      set.status = 200;
      return { publicKey: v.publicKey };
    });
}
