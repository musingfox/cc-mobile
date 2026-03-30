import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Vite plugin that stamps the service worker with a build-time version and BASE_PATH.
 * Replaces __BUILD_VERSION__ and __BASE_PATH__ placeholders in sw.js and index.html.
 * Also updates manifest.json start_url and handles dev/prod icon switching.
 */
function swVersionPlugin(mode: string): Plugin {
  return {
    name: "sw-version",
    apply: "build",
    closeBundle() {
      const version = Date.now().toString(36);
      const basePath = process.env.BASE_PATH || "";
      const distDir = join(__dirname, "dist", "client");
      const isDev = mode !== "production";

      // Update sw.js
      const swPath = join(distDir, "sw.js");
      try {
        let content = readFileSync(swPath, "utf-8");
        content = content.replace("__BUILD_VERSION__", version);
        content = content.replace(/self\.__BASE_PATH__/g, `"${basePath}"`);

        // Replace icon paths with dev variants if dev mode
        if (isDev) {
          content = content.replace(/\/icons\/icon-192\.png/g, "/icons/icon-192-dev.png");
          content = content.replace(/\/icons\/icon-512\.png/g, "/icons/icon-512-dev.png");
          content = content.replace(
            /\/icons\/apple-touch-icon\.png/g,
            "/icons/apple-touch-icon-dev.png",
          );
        }

        writeFileSync(swPath, content);
        console.log(
          `[sw-version] stamped sw.js with version: ${version}, basePath: ${basePath}, mode: ${mode}`,
        );
      } catch {
        // sw.js not in dist — dev mode or build error, skip silently
      }

      // Update index.html
      const indexPath = join(distDir, "index.html");
      try {
        let content = readFileSync(indexPath, "utf-8");
        // Replace the script tag first (more specific pattern)
        content = content.replace(
          /window\.__BASE_PATH__ = "__BASE_PATH__"/g,
          `window.__BASE_PATH__ = "${basePath}"`,
        );
        // Then replace remaining __BASE_PATH__ placeholders in hrefs/src
        content = content.replace(/__BASE_PATH__\//g, `${basePath}/`);
        writeFileSync(indexPath, content);
        console.log(`[sw-version] updated index.html with basePath: ${basePath}`);
      } catch {
        // index.html not found, skip
      }

      // Update manifest.json
      const manifestPath = join(distDir, "manifest.json");
      const sourceManifest = isDev ? "manifest.dev.json" : "manifest.json";
      const clientDir = join(__dirname, "client", "public");

      try {
        // Copy the appropriate manifest source to dist
        copyFileSync(join(clientDir, sourceManifest), manifestPath);

        const content = readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(content);
        manifest.start_url = `${basePath}/`;
        // Update icon paths
        if (manifest.icons) {
          manifest.icons = manifest.icons.map((icon: { src: string }) => ({
            ...icon,
            src: basePath + icon.src,
          }));
        }
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(
          `[sw-version] updated manifest.json from ${sourceManifest}, start_url to: ${basePath}/`,
        );
      } catch {
        // manifest.json not found, skip
      }
    },
  };
}

/**
 * Vite plugin for dev mode: replaces __BASE_PATH__ in HTML and handles dev icon switching.
 */
function htmlTransformPlugin(mode: string): Plugin {
  return {
    name: "html-transform",
    transformIndexHtml(html) {
      const basePath = process.env.BASE_PATH || "";
      const isDev = mode !== "production";

      // Replace the script tag first (more specific pattern)
      let transformed = html.replace(
        /window\.__BASE_PATH__ = "__BASE_PATH__"/g,
        `window.__BASE_PATH__ = "${basePath}"`,
      );
      // Then replace remaining __BASE_PATH__ placeholders in hrefs/src
      transformed = transformed.replace(/__BASE_PATH__\//g, `${basePath}/`);

      // Dev mode transformations
      if (isDev) {
        // Switch to dev manifest
        transformed = transformed.replace(
          /href="([^"]*)\/manifest\.json"/,
          'href="$1/manifest.dev.json"',
        );
        // Switch to dev apple-touch-icon
        transformed = transformed.replace(
          /href="([^"]*)\/icons\/apple-touch-icon\.png"/,
          'href="$1/icons/apple-touch-icon-dev.png"',
        );
        // Update apple-mobile-web-app-title
        transformed = transformed.replace(
          /<meta name="apple-mobile-web-app-title" content="CCMobile" \/>/,
          '<meta name="apple-mobile-web-app-title" content="CCMobile DEV" />',
        );
      }

      return transformed;
    },
  };
}

export default defineConfig(({ mode }) => {
  const apiPort = process.env.VITE_API_PORT || "3001";
  const basePath = process.env.BASE_PATH || "";

  // Build proxy config dynamically based on basePath
  const wsPath = basePath ? `${basePath}/ws` : "/ws";
  const apiPath = basePath ? `${basePath}/api` : "/api";

  return {
    plugins: [react(), swVersionPlugin(mode), htmlTransformPlugin(mode)],
    root: "client",
    base: basePath || "/",
    build: {
      outDir: "../dist/client",
      emptyOutDir: true,
    },
    server: {
      allowedHosts: true,
      proxy: {
        [wsPath]: {
          target: `ws://localhost:${apiPort}`,
          ws: true,
        },
        [apiPath]: {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
