import { swRegistrationManager } from "./sw-registration";

let cachedPublicKey: string | null = null;
let primingPromise: Promise<void> | null = null;

/** @internal exported only for test isolation of module state */
export function __resetForTests(): void {
  cachedPublicKey = null;
  primingPromise = null;
}

/**
 * Primes the VAPID public key at startup (before any user gesture).
 * Fetched once; subsequent calls return the same promise.
 */
export async function primePublicKey(): Promise<void> {
  if (primingPromise) {
    return primingPromise;
  }
  primingPromise = (async () => {
    try {
      if (typeof window === "undefined") {
        cachedPublicKey = null;
        return;
      }
      const basePath = (window as any).__BASE_PATH__ || "";
      const res = await fetch(`${basePath}/api/push/public-key`);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        cachedPublicKey =
          data &&
          typeof data === "object" &&
          "publicKey" in data &&
          typeof data.publicKey === "string"
            ? data.publicKey
            : null;
      } else {
        cachedPublicKey = null;
      }
    } catch {
      cachedPublicKey = null;
    }
  })();
  return primingPromise;
}

export function getCachedPublicKey(): string | null {
  return cachedPublicKey;
}

// `Uint8Array<ArrayBuffer>` rather than the default `Uint8Array<ArrayBufferLike>`:
// `applicationServerKey` takes a BufferSource, which excludes a view that might
// be backed by a SharedArrayBuffer.
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushSubscriptionJSON = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/**
 * Uploads subscription JSON over HTTP (survives WS down).
 * Rejects on !ok with body text in message.
 */
export async function uploadSubscription(sub: PushSubscriptionJSON): Promise<void> {
  const basePath = typeof window !== "undefined" ? (window as any).__BASE_PATH__ || "" : "";
  const response = await fetch(`${basePath}/api/push/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `subscribe failed with ${response.status}`);
  }
}

/**
 * Resync on app open: re-uploads current sub (or subscribes if none) only if enabled+granted.
 * Never prompts, never throws, returns "uploaded" or "skipped".
 */
export async function resyncPushSubscription(opts: {
  enabled: boolean;
}): Promise<"uploaded" | "skipped"> {
  if (!opts.enabled) {
    return "skipped";
  }
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "skipped";
  }
  if (Notification.permission !== "granted") {
    return "skipped";
  }
  const registration = swRegistrationManager.getRegistration();
  if (!registration || !registration.pushManager) {
    return "skipped";
  }
  try {
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const pubKey = getCachedPublicKey();
      if (!pubKey) {
        return "skipped";
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pubKey),
      });
    }
    if (subscription) {
      await uploadSubscription(subscription.toJSON() as PushSubscriptionJSON);
      return "uploaded";
    }
    return "skipped";
  } catch {
    return "skipped";
  }
}
