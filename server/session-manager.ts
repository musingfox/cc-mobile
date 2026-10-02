/**
 * session-manager.ts — what `interrupt` still reaches on the server.
 *
 * Since #25 this owns no conversation driver. The SDK `query()` path it used to
 * run is gone; turns are driven by the terminal backend (herdr) instead. The
 * session map went too: #26 deleted its last writer, so all that remains is the
 * upload cleanup a closed session is owed.
 *
 * The settings state that used to live here — permission mode, model, effort,
 * env vars — is gone with the messages that set it. herdr received none of it,
 * and an agent's gating and model are the agent's own settings rather than
 * cc-mobile's to decide.
 */

import { cleanupUploads } from "./upload-manager";

export class SessionManager {
  destroySession(sessionId: string): void {
    // Cleanup uploaded files for this session
    cleanupUploads(sessionId).catch((err) => {
      console.warn(`[session-manager] cleanup failed for session ${sessionId}:`, err);
    });
  }
}
