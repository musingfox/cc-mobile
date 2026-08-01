import { buildPtyPrompt } from "../../utils/pty-prompt-builder";

interface SendArgs {
  sessionId: string;
  cwd: string;
  text: string;
  images: Array<{ base64: string; mediaType: string }>;
  fileAbsPaths: string[];
  uploadImage: (sessionId: string, base64: string, mediaType: string) => Promise<{ path: string }>;
  ptySend: (sessionId: string, cwd: string, prompt: string) => void;
  // Present only for terminal-backed (live herdr) sessions; when set it takes
  // the prompt instead of ptySend.
  terminalSend?: (sessionId: string, prompt: string) => void;
  clearInputs: () => void;
}

// Module-level landing flag for re-entrancy guard.
let landing = false;

/**
 * Orchestrates the send flow:
 *   1. If landing is already in progress, drop (re-entrancy guard).
 *   2. Upload each image to get an absolute server path.
 *   3. Build the PTY prompt (text + landed image paths + file paths).
 *   4. Call the session's send fn exactly once.
 *   5. Call clearInputs.
 */
export async function runSend({
  sessionId,
  cwd,
  text,
  images,
  fileAbsPaths,
  uploadImage,
  ptySend,
  terminalSend,
  clearInputs,
}: SendArgs): Promise<void> {
  if (landing) return;

  const deliver = (prompt: string) => {
    if (terminalSend) terminalSend(sessionId, prompt);
    else ptySend(sessionId, cwd, prompt);
  };

  if (images.length === 0) {
    // Fast path: no uploads needed.
    const prompt = buildPtyPrompt(text, [], fileAbsPaths);
    deliver(prompt);
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
    deliver(prompt);
    clearInputs();
  } finally {
    landing = false;
  }
}
