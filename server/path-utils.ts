import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

/**
 * Builds a URL path by concatenating basePath and path.
 * Contract 2: buildUrl
 */
export function buildUrl(basePath: string, path: string): string {
  return basePath + path;
}

/**
 * Strips basePath prefix from pathname.
 * Contract 3: stripBasePath
 */
export function stripBasePath(pathname: string, basePath: string): string {
  if (basePath === "") {
    return pathname;
  }

  if (pathname === basePath || pathname.startsWith(basePath + "/")) {
    const stripped = pathname.slice(basePath.length);
    return stripped || "/";
  }

  return pathname;
}

// ── Internal helpers (mirroring ws.ts logic) ──────────────────────────────

function expandPath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

function validateCwdInternal(cwd: string): string | null {
  if (!existsSync(cwd)) return `Path does not exist: ${cwd}`;
  if (!statSync(cwd).isDirectory()) return `Not a directory: ${cwd}`;
  return null;
}

function validateAllowedPathInternal(cwd: string, allowedRoots: string[] | null): boolean {
  if (allowedRoots === null) {
    return true;
  }

  let normalizedCwd: string;
  try {
    normalizedCwd = realpathSync(cwd);
  } catch {
    normalizedCwd = resolve(cwd);
  }

  const ensureTrailingSep = (p: string) => (p.endsWith(sep) ? p : p + sep);

  for (const root of allowedRoots) {
    let normalizedRoot: string;
    try {
      normalizedRoot = realpathSync(root);
    } catch {
      normalizedRoot = resolve(root);
    }

    if (
      normalizedCwd === normalizedRoot ||
      normalizedCwd.startsWith(ensureTrailingSep(normalizedRoot))
    ) {
      return true;
    }
  }

  return false;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Resolves and validates a raw cwd string.
 *
 * Steps (mirrors new_session L209-226 in ws.ts):
 *   1. expandPath (home expansion + resolve)
 *   2. validateCwd (exists + is directory) → invalid_cwd on failure
 *   3. validateAllowedPath (allowed roots check) → path_not_allowed on failure
 *   4. { ok: true, path: expanded }
 */
export function resolveAndValidateCwd(
  rawCwd: string,
  allowedRoots: string[] | null,
):
  | { ok: true; path: string }
  | { ok: false; error: { code: "invalid_cwd" | "path_not_allowed"; message: string } } {
  const expanded = expandPath(rawCwd);

  const cwdError = validateCwdInternal(expanded);
  if (cwdError) {
    return { ok: false, error: { code: "invalid_cwd", message: cwdError } };
  }

  if (!validateAllowedPathInternal(expanded, allowedRoots)) {
    return {
      ok: false,
      error: { code: "path_not_allowed", message: "Project path is not in the allowed roots" },
    };
  }

  return { ok: true, path: expanded };
}
