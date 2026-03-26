/**
 * Uploads a file to the server for use as an attachment.
 * @param sessionId - The active session ID
 * @param file - The file to upload
 * @returns Promise with server-side path, filename, and size
 */
export async function uploadFile(
  sessionId: string,
  file: File,
): Promise<{ path: string; filename: string; sizeKB: number }> {
  const basePath = typeof window !== "undefined" ? (window as any).__BASE_PATH__ || "" : "";

  const formData = new FormData();
  formData.append("sessionId", sessionId);
  formData.append("file", file);

  const response = await fetch(`${basePath}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upload failed: ${error}`);
  }

  const data = await response.json();
  return {
    path: data.path,
    filename: data.filename,
    sizeKB: data.sizeKB,
  };
}
