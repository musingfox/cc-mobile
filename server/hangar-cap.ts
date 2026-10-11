export const FALLBACK_HANGAR_CAP = 4;

/** Performance cores minus two, floor one; the fallback when the count cannot be read. */
export function resolveHangarCap(
  _env: string | undefined,
  readPerfCores: () => number | null,
): number {
  let n: number | null;
  try {
    n = readPerfCores();
  } catch {
    return FALLBACK_HANGAR_CAP;
  }
  if (n === null || !Number.isInteger(n) || n < 1) return FALLBACK_HANGAR_CAP;
  return Math.max(1, n - 2);
}
