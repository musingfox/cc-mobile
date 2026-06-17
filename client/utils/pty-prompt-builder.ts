/**
 * Builds a PTY prompt string from text and optional attachment paths.
 *
 * Contract:
 *   - No attachments → returns text byte-identical
 *   - Attachments present → text (if any) + blank line + frame sentence + paths (images first, then files)
 *   - Paths emitted verbatim, unquoted, one per line
 *   - No trailing newline
 *   - Empty text with attachments → no leading newline
 */
export function buildPtyPrompt(
  text: string,
  imageAbsPaths: string[],
  fileAbsPaths: string[],
): string {
  const allPaths = [...imageAbsPaths, ...fileAbsPaths];
  if (allPaths.length === 0) {
    return text;
  }

  const frameLines = [
    "Please read these attached files using the Read tool:",
    ...allPaths.map((p) => `- ${p}`),
  ].join("\n");

  if (!text) {
    return frameLines;
  }

  return `${text}\n\n${frameLines}`;
}
