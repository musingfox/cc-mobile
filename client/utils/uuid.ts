/**
 * uuid.ts — a uuid v4 that exists on the origin the phone actually uses.
 *
 * `crypto.randomUUID` is gated on a secure context, and cc-mobile is reached
 * over plain http on a Tailscale IP (`http://100.88.181.24:7701/`), which is
 * not one. There it is not merely absent — reading it and calling it throws
 * `TypeError: crypto.randomUUID is not a function`, so the tap that generates a
 * session id dies inside its own handler: no session, no navigation, no toast.
 * Verified live 2026-08-06 in a browser on that exact origin
 * (`window.isSecureContext === false`, `typeof crypto.randomUUID === "undefined"`).
 *
 * `crypto.getRandomValues` carries no such gate — it is on `Crypto`, not on
 * `SubtleCrypto` — so the fallback is still CSPRNG-backed, not `Math.random`.
 *
 * The shape matters as much as the randomness: the server derives its herdr
 * workspace label from this string and reads ownership back out of it with
 * `WORKSPACE_LABEL_PATTERN` (`server/herdr/registry.ts`), and claude is handed
 * it as `--session-id`. A merely-unique string would be created and then
 * disowned on the next listing.
 */

/** A random uuid v4, on a secure origin or otherwise. */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Version 4 and the RFC 4122 variant, the two fields that are not random.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
