import { createHash } from "node:crypto";

/**
 * Stable opaque identifier for a transcript file's content identity.
 * Used so client and server agree which file a chunk/page came from without
 * shipping the full path.
 * 16 lowercase hex chars (first 64 bits of sha256 of the path bytes).
 */
export function epochOf(path: string): string {
  const digest = createHash("sha256").update(path, "utf8").digest("hex");
  return digest.slice(0, 16);
}
