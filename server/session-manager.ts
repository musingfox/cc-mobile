/**
 * session-manager.ts — the server's session registry and settings state.
 *
 * Since #25 this owns no conversation driver. The SDK `query()` path it used to
 * run is gone; turns are driven by the terminal backend (herdr) instead, and
 * what remains here is the session map.
 *
 * The settings state that used to live here — permission mode, model, effort,
 * env vars — is gone with the messages that set it. herdr received none of it,
 * and an agent's gating and model are the agent's own settings rather than
 * cc-mobile's to decide.
 */

import type { ContentBlock } from "./protocol";
import { cleanupUploads } from "./upload-manager";

interface SessionConfig {
  cwd: string;
  sdkSessionId: string | null;
  pendingAppendBlocks: ContentBlock[];
}

const APPEND_BUFFER_MAX_COUNT = 50;
const APPEND_BUFFER_MAX_BYTES = 1024 * 1024; // 1MB

function contentToBlocks(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}

function blocksByteSize(blocks: ContentBlock[]): number {
  let total = 0;
  for (const b of blocks) {
    if (b.type === "text") {
      total += b.text.length;
    } else if (b.type === "image") {
      total += b.source.data.length;
    }
  }
  return total;
}

export class SessionManager {
  private sessions = new Map<string, SessionConfig>();

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async createSession(sessionId: string, cwd: string, sdkSessionId?: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    this.sessions.set(sessionId, {
      cwd,
      sdkSessionId: sdkSessionId ?? null,
      pendingAppendBlocks: [],
    });
  }

  /**
   * Buffer a user message for the session. Enforces a cap of 50 entries OR 1MB
   * total bytes; rejects atomically when adding the new content would breach
   * either limit.
   *
   * TODO(#25-followup): the buffer has had no consumer since the SDK turn
   * driver was removed — nothing drains it into an outgoing turn.
   */
  appendUserMessage(sessionId: string, content: string | ContentBlock[]): void {
    const config = this.sessions.get(sessionId);
    if (!config) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const newBlocks = contentToBlocks(content);
    const existingCount = config.pendingAppendBlocks.length;
    const existingBytes = blocksByteSize(config.pendingAppendBlocks);
    const newBytes = blocksByteSize(newBlocks);

    if (
      existingCount + newBlocks.length > APPEND_BUFFER_MAX_COUNT ||
      existingBytes + newBytes > APPEND_BUFFER_MAX_BYTES
    ) {
      throw new Error("append_buffer_full");
    }

    config.pendingAppendBlocks.push(...newBlocks);
  }

  /**
   * Stop a subagent task. There is no in-process turn to stop any more, so this
   * always reports `no_active_query` through `emitError`. Never throws.
   *
   * TODO(#25-followup): the UI's stop button is a no-op until herdr exposes a
   * per-task interrupt.
   */
  async stopTask(
    _sessionId: string,
    _taskId: string,
    emitError: (code: string, message: string) => void,
  ): Promise<void> {
    emitError("no_active_query", "No active turn to stop");
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);

    // Cleanup uploaded files for this session
    cleanupUploads(sessionId).catch((err) => {
      console.warn(`[session-manager] cleanup failed for session ${sessionId}:`, err);
    });
  }
}
