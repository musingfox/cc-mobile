import { getSessionInfo, listSessions, type SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { SessionListItem } from "./protocol";

/**
 * List Claude Code sessions with transformed metadata.
 *
 * @param options - Optional filtering and pagination
 * @returns Array of session items sorted by lastModified desc
 */
export async function listClaudeSessions(options?: {
  dir?: string;
  limit?: number;
  offset?: number;
}): Promise<SessionListItem[]> {
  const sessions = await listSessions({
    dir: options?.dir,
    limit: options?.limit,
    offset: options?.offset,
  });

  return sessions.map(transformSessionInfo);
}

/**
 * Get info for a single session.
 *
 * @param sessionId - SDK session ID
 * @param dir - Optional working directory
 * @returns Session info or null if not found
 */
export async function getClaudeSessionInfo(
  sessionId: string,
  dir?: string,
): Promise<SessionListItem | null> {
  const info = await getSessionInfo(sessionId, dir ? { dir } : undefined);
  if (!info) return null;
  return transformSessionInfo(info);
}

/**
 * Transform SDK session info to SessionListItem.
 * Display title priority: customTitle > firstPrompt > summary > "Untitled"
 */
function transformSessionInfo(info: SDKSessionInfo): SessionListItem {
  const displayTitle = info.customTitle || info.firstPrompt || info.summary || "Untitled";

  return {
    sdkSessionId: info.sessionId,
    displayTitle,
    cwd: info.cwd || "",
    gitBranch: info.gitBranch,
    lastModified: info.lastModified,
    createdAt: info.createdAt,
  };
}
