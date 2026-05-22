/**
 * Truncates large tool outputs while preserving head and tail so the model
 * (and the mobile client) still see the start and end of long results. Only
 * activates above the threshold; smaller outputs pass through unchanged.
 *
 * Strategy: keep the first HEAD_CHARS + last TAIL_CHARS characters joined by
 * a single-line marker describing how much was elided. Counting characters
 * is a reasonable proxy for byte size for ASCII-heavy outputs (Bash logs,
 * Read of source files) and avoids re-encoding through Buffer.
 */
const MAX_CHARS = 64 * 1024;
const HEAD_CHARS = 24 * 1024;
const TAIL_CHARS = 24 * 1024;

function truncateString(text: string): { text: string; elided: number } | null {
  if (text.length <= MAX_CHARS) return null;
  const elided = text.length - HEAD_CHARS - TAIL_CHARS;
  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  return {
    text: `${head}\n\n… [cc-mobile truncated ${elided.toLocaleString("en-US")} chars] …\n\n${tail}`,
    elided,
  };
}

/**
 * Walk a tool_response and truncate any oversized string payloads.
 * Returns the new value if anything was changed, otherwise null.
 *
 * Recognised shapes:
 *   - raw string
 *   - { content: [{ type: "text", text: "..." }, ...] }  (MCP-style)
 *   - { output: string } / { stdout: string } / { text: string }
 *
 * Anything else is returned unchanged (null) — better to skip than to
 * mutate an unfamiliar structure incorrectly.
 */
export function truncateToolResponse(response: unknown): unknown | null {
  if (typeof response === "string") {
    const truncated = truncateString(response);
    return truncated ? truncated.text : null;
  }

  if (response === null || typeof response !== "object") return null;

  const obj = response as Record<string, unknown>;
  let mutated = false;
  const next: Record<string, unknown> = { ...obj };

  if (Array.isArray(obj.content)) {
    const newContent = obj.content.map((block) => {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        const truncated = truncateString((block as { text: string }).text);
        if (truncated) {
          mutated = true;
          return { ...(block as object), text: truncated.text };
        }
      }
      return block;
    });
    if (mutated) next.content = newContent;
  }

  for (const key of ["output", "stdout", "stderr", "text"] as const) {
    const value = obj[key];
    if (typeof value === "string") {
      const truncated = truncateString(value);
      if (truncated) {
        next[key] = truncated.text;
        mutated = true;
      }
    }
  }

  return mutated ? next : null;
}

/** Exposed for tests so thresholds stay in one place. */
export const TRUNCATE_THRESHOLD_CHARS = MAX_CHARS;
