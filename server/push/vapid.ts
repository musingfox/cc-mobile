export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** Contact the push service uses if a send misbehaves; `mailto:` or `https:`. */
  subject?: string;
}

/**
 * Read at call time, never cached: the private key lives in the environment
 * only. It is never written to disk by this process, never logged, and never
 * part of a push payload.
 */
export function loadVapidKeys(
  env: Record<string, string | undefined> = process.env,
): VapidKeys | null {
  const pub = env.CC_MOBILE_VAPID_PUBLIC_KEY;
  const priv = env.CC_MOBILE_VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  const subject = env.CC_MOBILE_VAPID_SUBJECT;
  return subject
    ? { publicKey: pub, privateKey: priv, subject }
    : { publicKey: pub, privateKey: priv };
}
