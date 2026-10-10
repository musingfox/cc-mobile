/** Mirrors server/path-utils isWithinRoot; no imports so the server stays out of the phone bundle. */
export function isWithinAllowedRoots(path: string, roots: string[] | null): boolean {
  if (roots === null) return true;
  return roots.some((r) => path === r || path.startsWith(r.endsWith("/") ? r : `${r}/`));
}
