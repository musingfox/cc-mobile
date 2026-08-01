import { buildPtyPrompt } from "../../utils/pty-prompt-builder";

interface SendArgs {
  sessionId: string;
  cwd: string;
  text: string;
  images: Array<{ base64: string; mediaType: string }>;
  fileAbsPaths: string[];
  uploadImage: (sessionId: string, base64: string, mediaType: string) => Promise<{ path: string }>;
  /**
   * Present only for terminal-backed (live herdr) sessions. Absent means the
   * session is a read-only history view (#25 D1): nothing is sent, nothing is
   * uploaded, and the composer keeps whatever the user typed.
   */
  terminalSend?: (sessionId: string, prompt: string) => void;
  clearInputs: () => void;
}

// Module-level landing flag for re-entrancy guard.
let landing = false;

/**
 * Orchestrates the send flow:
 *   1. If the session has no terminal, drop (read-only history view).
 *   2. If landing is already in progress, drop (re-entrancy guard).
 *   3. Upload each image to get an absolute server path.
 *   4. Build the prompt (text + landed image paths + file paths).
 *   5. Call terminalSend exactly once.
 *   6. Call clearInputs.
 */
export async function runSend({
  sessionId,
  text,
  images,
  fileAbsPaths,
  uploadImage,
  terminalSend,
  clearInputs,
}: SendArgs): Promise<void> {
  // Read-only session: refuse silently. Uploads are skipped too — landing an
  // image for a prompt that can never be sent just litters the upload dir.
  if (!terminalSend) return;
  if (landing) return;

  if (images.length === 0) {
    // Fast path: no uploads needed.
    const prompt = buildPtyPrompt(text, [], fileAbsPaths);
    terminalSend(sessionId, prompt);
    clearInputs();
    return;
  }

  landing = true;
  try {
    const landedPaths: string[] = [];
    for (const img of images) {
      const result = await uploadImage(sessionId, img.base64, img.mediaType);
      landedPaths.push(result.path);
    }
    const prompt = buildPtyPrompt(text, landedPaths, fileAbsPaths);
    terminalSend(sessionId, prompt);
    clearInputs();
  } finally {
    landing = false;
  }
}
