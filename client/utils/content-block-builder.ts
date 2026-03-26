import type { ContentBlock, ImageBlock, TextBlock } from "../../server/protocol";

/**
 * Builds content blocks for multimodal messages.
 * @param text - The user's text input
 * @param images - Array of base64-encoded images
 * @param filePaths - Array of server-side file paths
 * @returns String if text-only, or array of content blocks if multimodal
 */
export function buildContentBlocks(
  text: string,
  images: Array<{ base64: string; mediaType: string }>,
  filePaths: string[],
): string | ContentBlock[] {
  // If no images and no files, return plain string
  if (images.length === 0 && filePaths.length === 0) {
    return text;
  }

  // If only files (no images), return as string with file references
  if (images.length === 0 && filePaths.length > 0) {
    const fileReferences = filePaths.map((path) => `[Attached file: ${path}]`).join("\n");
    return text ? `${text}\n${fileReferences}` : fileReferences;
  }

  // We have images, so build content blocks array
  const blocks: ContentBlock[] = [];

  // Build text block with file references if any
  let textContent = text;
  if (filePaths.length > 0) {
    const fileReferences = filePaths.map((path) => `[Attached file: ${path}]`).join("\n");
    textContent = text ? `${text}\n${fileReferences}` : fileReferences;
  }

  // Add text block if there's any content
  if (textContent) {
    blocks.push({
      type: "text",
      text: textContent,
    } as TextBlock);
  }

  // Add image blocks
  for (const img of images) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: img.base64,
      },
    } as ImageBlock);
  }

  return blocks;
}
