import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

/**
 * Vite plugin that stamps the service worker with a build-time version and BASE_PATH.
 * Replaces __BUILD_VERSION__ and __BASE_PATH__ placeholders in sw.js and index.html.
 * Also updates manifest.json start_url.
 */
function swVersionPlugin(): Plugin {
  return {
    name: "sw-version",
    apply: "build",
    closeBundle() {
      const version = Date.now().toString(36);
      const basePath = process.env.BASE_PATH || "";
      const distDir = join(__dirname, "dist", "client");

      // Update sw.js
      const swPath = join(distDir, "sw.js");
      try {
        let content = readFileSync(swPath, "utf-8");
        content = content.replace("__BUILD_VERSION__", version);
        content = content.replace(/self\.__BASE_PATH__/g, `"${basePath}"`);
        writeFileSync(swPath, content);
        console.log(`[sw-version] stamped sw.js with version: ${version}, basePath: ${basePath}`);
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
      try {
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
        console.log(`[sw-version] updated manifest.json start_url to: ${basePath}/`);
      } catch {
        // manifest.json not found, skip
      }
    },
  };
}

/**
 * Vite plugin for dev mode: replaces __BASE_PATH__ in HTML.
 */
function htmlTransformPlugin(): Plugin {
  return {
    name: "html-transform",
    transformIndexHtml(html) {
      const basePath = process.env.BASE_PATH || "";
      // Replace the script tag first (more specific pattern)
      let transformed = html.replace(
        /window\.__BASE_PATH__ = "__BASE_PATH__"/g,
        `window.__BASE_PATH__ = "${basePath}"`,
      );
      // Then replace remaining __BASE_PATH__ placeholders in hrefs/src
      transformed = transformed.replace(/__BASE_PATH__\//g, `${basePath}/`);
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
    plugins: [react(), swVersionPlugin(), htmlTransformPlugin()],
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
