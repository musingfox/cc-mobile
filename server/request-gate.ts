/**
 * request-gate.ts — the one check every request passes through.
 *
 * Two independent rungs, installed as a single root `.onRequest` in `app.ts` so
 * they cover the `/ws` upgrade, `/api/*` and the static catch-all with one
 * evaluation that fires once per request. Returning `undefined` lets the request
 * reach its route; returning a `Response` short-circuits before routing, which
 * is what makes a refused WebSocket fail at the handshake instead of becoming a
 * socket nobody wanted.
 *
 * Rung 1 — identity. `tailscale serve` injects `Tailscale-User-Login` on every
 * request it proxies, upgrades included (probed live 2026-08-20), and strips any
 * the client made up. `CC_MOBILE_TRUSTED_USER` is the whole rung's switch: unset
 * (or whitespace-only) and the rung does not exist. That env-gate is
 * load-bearing, not caution — dev reaches this server through the Vite proxy,
 * which injects no identity header at all, so an always-on rung would lock the
 * developer out of their own machine. The comparison is exact after trimming
 * both sides; a missing header and a wrong one are the same refusal, because
 * there is no scheme to challenge with and nothing to gain from telling them
 * apart.
 *
 * Rung 2 — origin, on WebSocket upgrades only. Its whole job is to stop a
 * browser being used as a confused deputy: a page on evil.example cannot be
 * allowed to open this server's socket and drive an agent. It runs on upgrades
 * only — detected by the `Upgrade` header, not the path, so it stays
 * `basePath`-agnostic — because the dev `/api` proxy sets `changeOrigin: true`
 * (`vite.config.ts`), which rewrites `Host` while forwarding the browser's
 * `Origin`; applying the same-origin rule there would 403 every dev upload and
 * push-subscribe. The `/ws` proxy entry has no `changeOrigin`, so dev passes
 * with no configuration, and `tailscale serve` does not rewrite `Host` either
 * (probed live), so production does too.
 *
 * **Trusting `Host` is deliberate — do not "fix" it.** Comparing `Origin`
 * against a header the client sends looks like a hole, and is not one: a forged
 * `Host` only lets an attacker match their own forged `Origin`, which buys them
 * nothing they did not already have, and a browser — the only attacker this
 * rung exists to stop — can forge neither. The authorisation layer is the
 * Tailscale identity rung above, never this comparison.
 *
 * An absent `Origin` is allowed: native clients send none at all (Bun's own WS
 * client included, measured), so denying it would break every non-browser
 * caller while stopping no browser. The literal string `"null"` — an opaque
 * origin, which is what a sandboxed iframe or a `data:` document sends — is a
 * different value and is refused, before the allowlist is consulted, so it can
 * never be allowlisted.
 */

/**
 * Just enough of a `Request` for the rules to read. Structural on purpose:
 * production hands in the real `Request`, while a test can hand in a bare
 * `{ headers }` — the `Request` constructor silently drops `Host`, `Upgrade`
 * and `Origin`, since the fetch spec forbids a client from setting them.
 */
export interface GateRequest {
  headers: { get(name: string): string | null };
}

type GateEnv = Record<string, string | undefined>;

/** The header `tailscale serve` injects, and the only identity claim trusted. */
const IDENTITY_HEADER = "tailscale-user-login";

/** Names the failing rung without echoing the configured or offered value. */
function forbidden(rule: "identity" | "origin"): Response {
  return new Response(`forbidden: ${rule}`, { status: 403 });
}

/** Trimmed, trailing-slash-free, lowercased — the shape origins compare in. */
function normaliseOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

/** `CC_MOBILE_ALLOWED_ORIGINS`, parsed in `parseAllowedRoots`' style. */
function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((entry) => normaliseOrigin(entry))
    .filter((entry) => entry.length > 0);
}

function checkIdentity(request: GateRequest, env: GateEnv): Response | undefined {
  const trusted = env.CC_MOBILE_TRUSTED_USER?.trim();
  if (!trusted) return undefined; // rung dormant — behaves exactly as before
  const presented = request.headers.get(IDENTITY_HEADER)?.trim();
  return presented === trusted ? undefined : forbidden("identity");
}

function checkOrigin(request: GateRequest, env: GateEnv): Response | undefined {
  const origin = request.headers.get("origin");
  if (origin === null) return undefined; // no browser sent this
  if (origin.trim().toLowerCase() === "null") return forbidden("origin");

  if (parseAllowedOrigins(env.CC_MOBILE_ALLOWED_ORIGINS).includes(normaliseOrigin(origin))) {
    return undefined;
  }

  const host = request.headers.get("host")?.trim();
  if (!host) return forbidden("origin");
  let originHost: string;
  try {
    originHost = new URL(origin.trim()).host;
  } catch {
    return forbidden("origin"); // unparseable is a denial, never a throw
  }
  return originHost.toLowerCase() === host.toLowerCase() ? undefined : forbidden("origin");
}

/**
 * The gate. `undefined` means "carry on"; a `Response` means the request stops
 * here, before any route sees it.
 */
export function evaluateRequestGate(
  request: GateRequest,
  env: GateEnv = process.env,
): Response | undefined {
  const identityDenial = checkIdentity(request, env);
  if (identityDenial) return identityDenial;
  // Upgrades only (see the file docstring): the dev `/api` proxy rewrites Host.
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return undefined;
  return checkOrigin(request, env);
}
