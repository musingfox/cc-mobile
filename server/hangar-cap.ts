export const FALLBACK_HANGAR_CAP = 4;

/**
 * A non-blank `env` pins the cap and must be a plain positive integer: a typo
 * throws rather than becoming a different cap than the operator wrote. Unset or
 * blank, the cap is performance cores minus two (floor one), or the fallback
 * when the count cannot be read.
 */
export function resolveHangarCap(
  env: string | undefined,
  readPerfCores: () => number | null,
): number {
  const pinned = env?.trim();
  if (pinned) {
    if (!/^[1-9][0-9]*$/.test(pinned)) {
      throw new Error(`CC_MOBILE_HANGAR_CAP must be a positive integer, got "${env}"`);
    }
    return Number.parseInt(pinned, 10);
  }
  let n: number | null;
  try {
    n = readPerfCores();
  } catch {
    return FALLBACK_HANGAR_CAP;
  }
  if (n === null || !Number.isInteger(n) || n < 1) return FALLBACK_HANGAR_CAP;
  return Math.max(1, n - 2);
}
