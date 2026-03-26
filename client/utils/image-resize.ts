/**
 * Resizes an image if it exceeds the specified dimensions or size threshold.
 * @param file - The image file to resize
 * @param maxDimension - Maximum width or height (default: 1568)
 * @param quality - JPEG/WebP quality 0-1 (default: 0.85)
 * @returns Promise with base64 data (without prefix), mediaType, and sizeKB
 * @throws Error if the file format is not supported
 */
export async function resizeImage(
  file: File,
  maxDimension = 1568,
  quality = 0.85,
): Promise<{ base64: string; mediaType: string; sizeKB: number }> {
  const supportedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  if (!supportedTypes.includes(file.type)) {
    throw new Error("Unsupported image format");
  }

  // Load the image
  const img = await loadImage(file);
  const needsResize =
    img.width > maxDimension || img.height > maxDimension || file.size > 3.75 * 1024 * 1024;

  let base64: string;
  let resultType: string;

  if (!needsResize) {
    // Return original
    const dataUrl = await readFileAsDataURL(file);
    const [prefix, data] = dataUrl.split(",");
    base64 = data;
    resultType = file.type;
  } else {
    // Resize using canvas
    const { width, height } = calculateResizeDimensions(img.width, img.height, maxDimension);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");

    ctx.drawImage(img, 0, 0, width, height);

    // Convert to base64
    // Use original format for PNG/GIF to preserve transparency, JPEG for others
    const outputType =
      file.type === "image/png" || file.type === "image/gif" ? file.type : "image/jpeg";
    const dataUrl = canvas.toDataURL(outputType, quality);
    const [prefix, data] = dataUrl.split(",");
    base64 = data;
    resultType = outputType;
  }

  // Calculate size in KB
  const sizeKB = Math.round((base64.length * 3) / 4 / 1024);

  return {
    base64,
    mediaType: resultType,
    sizeKB,
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function calculateResizeDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  const aspectRatio = width / height;
  if (width > height) {
    return {
      width: maxDimension,
      height: Math.round(maxDimension / aspectRatio),
    };
  } else {
    return {
      width: Math.round(maxDimension * aspectRatio),
      height: maxDimension,
    };
  }
}
