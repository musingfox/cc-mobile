/**
 * directory-listing.ts — filesystem browsing for the `list_directories` WS
 * message, extracted out of ws.ts so the transport module holds no fs access.
 *
 * The reply shape is unchanged: callers spread `listing` into the existing
 * `directory_listing` message, and map `error` onto the same three codes.
 */

import { readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { expandPath, validateAllowedPath, validateCwd } from "./path-utils";

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryListing {
  path: string;
  entries: DirectoryEntry[];
  /** null at the filesystem root, where there is nowhere further up. */
  parent: string | null;
}

export type ListDirectoriesResult =
  | { ok: true; listing: DirectoryListing }
  | {
      ok: false;
      error: {
        code: "invalid_path" | "path_not_allowed" | "permission_denied";
        message: string;
      };
    };

/**
 * Lists the sub-directories of `rawPath` (which may start with `~`).
 *
 * Plain files are filtered out. A symlink is included only when it resolves to
 * a directory that is itself inside `allowedRoots` — the check is against the
 * resolved target, not the link, so a link cannot smuggle a caller outside the
 * permitted roots.
 */
export function listDirectories(
  rawPath: string,
  allowedRoots: string[] | null,
): ListDirectoriesResult {
  const path = expandPath(rawPath);

  const cwdError = validateCwd(path);
  if (cwdError) {
    return { ok: false, error: { code: "invalid_path", message: cwdError } };
  }

  if (!validateAllowedPath(path, allowedRoots)) {
    return {
      ok: false,
      error: { code: "path_not_allowed", message: "Path is not in the allowed roots" },
    };
  }

  try {
    const entries = readdirSync(path, { withFileTypes: true });
    const directories: DirectoryEntry[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        directories.push({
          name: entry.name,
          path: join(path, entry.name),
        });
      } else if (entry.isSymbolicLink()) {
        try {
          const entryPath = join(path, entry.name);
          const resolvedPath = realpathSync(entryPath);
          const stats = statSync(resolvedPath);

          if (stats.isDirectory()) {
            if (validateAllowedPath(resolvedPath, allowedRoots)) {
              directories.push({
                name: entry.name,
                path: entryPath,
              });
            }
          }
        } catch {}
      }
    }

    directories.sort((a, b) => a.name.localeCompare(b.name));

    return {
      ok: true,
      listing: {
        path,
        entries: directories,
        parent: path === sep ? null : dirname(path),
      },
    };
  } catch {
    return {
      ok: false,
      error: { code: "permission_denied", message: `Cannot read directory: ${path}` },
    };
  }
}

/** Where the mobile directory browser opens: the first allowed root, else home. */
export function getInitialBrowsePath(allowedRoots: string[] | null, homeDirectory: string): string {
  if (allowedRoots && allowedRoots.length > 0) {
    return allowedRoots[0];
  }
  return homeDirectory;
}
