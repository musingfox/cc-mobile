/**
 * agent-notice.ts — announce a blocked screen's own words once per episode,
 * and a claude trust dialog sitting on idle once per session.
 *
 * Uses notice-text.ts for the fenced body. Empty screens stay silent.
 * The blocked ledger is forgotten when the caller ends the episode; the idle
 * ledger is forgotten only when the session itself is gone, so a status
 * flicker cannot re-announce an already-seen dialog.
 *
 * The client slice names paneRead and nothing else: this module cannot send
 * a key, arm a deny timer, or raise a permission card.
 */

import { isClaudeAttentionScreen } from "./claude-idle-screen";
import { noticeTextFrom } from "./notice-text";

export type ClientSink = (msg: Record<string, unknown>) => void;

/** Detection-only pane read. No send method exists on this slice. */
export interface AgentNoticeReadClient {
  paneRead(params: {
    pane_id: string;
    source: "detection";
  }): Promise<{ text: string; revision: number }>;
}

export interface AgentNoticeOptions {
  getSink: (sessionId: string) => ClientSink | undefined;
  client?: AgentNoticeReadClient;
  warn?: (message: string) => void;
}

function ledgerFor(map: Map<string, Set<string>>, sessionId: string, screen: string): boolean {
  let seen = map.get(sessionId);
  if (!seen) {
    seen = new Set();
    map.set(sessionId, seen);
  }
  if (seen.has(screen)) return false;
  seen.add(screen);
  return true;
}

export function createAgentNotice(options: AgentNoticeOptions) {
  const { getSink } = options;
  const warn =
    options.warn ?? ((message: string) => console.warn(`[herdr] notice: ${message}`));

  /** sessionId → screens already announced in this blocked episode. */
  const announced = new Map<string, Set<string>>();
  /** sessionId → idle attention screens already announced for this pane. */
  const idleAnnounced = new Map<string, Set<string>>();

  function shouldAnnounce(sessionId: string, screen: string): boolean {
    return ledgerFor(announced, sessionId, screen);
  }

  function clear(sessionId: string): void {
    announced.delete(sessionId);
  }

  function forgetEpisode(sessionId: string): void {
    clear(sessionId);
  }

  function forget(sessionId: string): void {
    announced.delete(sessionId);
    idleAnnounced.delete(sessionId);
  }

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

  async function readIdleScreen(sessionId: string): Promise<string | undefined> {
    const paneRead = options.client?.paneRead;
    try {
      if (typeof paneRead !== "function") {
        throw new Error("paneRead is not a function");
      }
      const read = await paneRead({ pane_id: sessionId, source: "detection" });
      return read.text;
    } catch (error) {
      warn(`${sessionId}: pane.read failed: ${describe(error)}`);
      return undefined;
    }
  }

  /**
   * Observe an idle pane. Reads only. Never sends keys, never arms a timer,
   * never emits a permission_request.
   */
  async function onStatus(sessionId: string, status: string, kind?: string): Promise<void> {
    if (status !== "idle") return;
    if (kind && kind !== "claude") return;

    const screen = await readIdleScreen(sessionId);
    if (screen === undefined) return;
    if (!isClaudeAttentionScreen(screen)) return;

    const message = noticeTextFrom(screen);
    if (message === null) return;
    if (!ledgerFor(idleAnnounced, sessionId, screen)) return;
    getSink(sessionId)?.({
      type: "error",
      code: "agent_attention_notice",
      sessionId,
      message,
    });
  }

  return { shouldAnnounce, clear, forgetEpisode, announceBlockedScreen, onStatus, forget };
}

export type AgentNotice = ReturnType<typeof createAgentNotice>;
