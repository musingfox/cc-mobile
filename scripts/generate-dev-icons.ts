import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const projectRoot = join(import.meta.dir, "..");
const iconsDir = join(projectRoot, "client", "public", "icons");

interface IconConfig {
  input: string;
  output: string;
  size: number;
}

const icons: IconConfig[] = [
  { input: "icon-192.png", output: "icon-192-dev.png", size: 192 },
  { input: "icon-512.png", output: "icon-512-dev.png", size: 512 },
  { input: "apple-touch-icon.png", output: "apple-touch-icon-dev.png", size: 180 },
];

/**
 * Shift hue of colored pixels (orange → blue, green → purple)
 * while preserving the dark background and luminance.
 */
function shiftHue(r: number, g: number, b: number): [number, number, number] {
  // Convert RGB to HSL
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  // Skip near-grey pixels (background) — low saturation
  if (d < 0.08) return [r, g, b];

  const s = l > 0.5 ? d / (2 - max - min) : d / (max - min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;

  // Shift hue by ~200 degrees (0.556 in 0-1 range) → orange→blue, green→purple
  let newH = (h + 0.556) % 1;

  // HSL to RGB
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, newH + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, newH) * 255),
    Math.round(hue2rgb(p, q, newH - 1 / 3) * 255),
  ];
}

async function generateDevIcon(config: IconConfig): Promise<void> {
  const inputPath = join(iconsDir, config.input);
  const outputPath = join(iconsDir, config.output);

  if (!existsSync(inputPath)) {
    console.error(`Input icon not found: ${inputPath}`);
    throw new Error(`Missing icon: ${config.input}`);
  }

  const metadata = await sharp(inputPath).metadata();
  const channels = metadata.channels ?? 3;
  const hasAlpha = metadata.hasAlpha ?? false;

  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });

  // Apply hue shift pixel by pixel
  const output = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += channels) {
    const [nr, ng, nb] = shiftHue(data[i], data[i + 1], data[i + 2]);
    output[i] = nr;
    output[i + 1] = ng;
    output[i + 2] = nb;
    // Copy alpha if present
    if (hasAlpha && channels === 4) {
      output[i + 3] = data[i + 3];
    }
  }

  await sharp(output, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toFile(outputPath);

  console.log(`Generated: ${config.output}`);
}

async function main() {
  console.log("Generating dev icons with hue shift (blue/purple)...");

  for (const icon of icons) {
    await generateDevIcon(icon);
  }

  console.log("All dev icons generated successfully.");
}

main().catch((error) => {
  console.error("Failed to generate dev icons:", error);
  process.exit(1);
});
