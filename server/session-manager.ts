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

import { cleanupUploads } from "./upload-manager";

interface SessionConfig {
  cwd: string;
  sdkSessionId: string | null;
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
    });
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);

    // Cleanup uploaded files for this session
    cleanupUploads(sessionId).catch((err) => {
      console.warn(`[session-manager] cleanup failed for session ${sessionId}:`, err);
    });
  }
}
