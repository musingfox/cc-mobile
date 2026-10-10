/** True while `count` has not exceeded `limit`. */
export function isWithinLimit(count: number, limit: number): boolean {
  return count > limit;
}
