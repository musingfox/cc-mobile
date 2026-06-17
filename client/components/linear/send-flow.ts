import { buildPtyPrompt } from "../../utils/pty-prompt-builder";

interface SendArgs {
  sessionId: string;
  cwd: string;
  text: string;
  images: Array<{ base64: string; mediaType: string }>;
  fileAbsPaths: string[];
  uploadImage: (sessionId: string, base64: string, mediaType: string) => Promise<{ path: string }>;
  ptySend: (sessionId: string, cwd: string, prompt: string) => void;
  clearInputs: () => void;
}

// Module-level landing flag for re-entrancy guard.
let landing = false;

/**
 * Orchestrates the send flow:
 *   1. If landing is already in progress, drop (re-entrancy guard).
 *   2. Upload each image to get an absolute server path.
 *   3. Build the PTY prompt (text + landed image paths + file paths).
 *   4. Call ptySend exactly once.
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
  clearInputs,
}: SendArgs): Promise<void> {
  if (landing) return;

  if (images.length === 0) {
    // Fast path: no uploads needed.
    const prompt = buildPtyPrompt(text, [], fileAbsPaths);
    ptySend(sessionId, cwd, prompt);
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
    ptySend(sessionId, cwd, prompt);
    clearInputs();
  } finally {
    landing = false;
  }
}
