/**
 * agent-notice.ts — announce a blocked screen's own words once per episode.
 *
 * Uses notice-text.ts for the fenced body. Empty screens stay silent. The
 * ledger is per session and is forgotten when the caller ends the episode, so
 * a later blocked turn with the same text can speak again.
 */

import { noticeTextFrom } from "./notice-text";

export type ClientSink = (msg: Record<string, unknown>) => void;

export interface AgentNoticeOptions {
  getSink: (sessionId: string) => ClientSink | undefined;
}

export function createAgentNotice(options: AgentNoticeOptions) {
  const { getSink } = options;
  /** sessionId → screens already announced in this episode. */
  const announced = new Map<string, Set<string>>();

  function shouldAnnounce(sessionId: string, screen: string): boolean {
    let seen = announced.get(sessionId);
    if (!seen) {
      seen = new Set();
      announced.set(sessionId, seen);
    }
    if (seen.has(screen)) return false;
    seen.add(screen);
    return true;
  }

  function clear(sessionId: string): void {
    announced.delete(sessionId);
  }

  function forgetEpisode(sessionId: string): void {
    clear(sessionId);
  }

  function announceBlockedScreen(sessionId: string, screen: string): void {
    const message = noticeTextFrom(screen);
    if (message === null) return;
    if (!shouldAnnounce(sessionId, screen)) return;
    getSink(sessionId)?.({
      type: "error",
      code: "agent_blocked_notice",
      sessionId,
      message,
    });
  }

  return { shouldAnnounce, clear, forgetEpisode, announceBlockedScreen };
}

export type AgentNotice = ReturnType<typeof createAgentNotice>;
