import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

/**
 * Vite plugin that stamps the service worker with a build-time version.
 * Replaces __BUILD_VERSION__ placeholder in sw.js after Vite copies public/ to dist/.
 */
function swVersionPlugin(): Plugin {
  return {
    name: "sw-version",
    apply: "build",
    closeBundle() {
      const version = Date.now().toString(36);
      const swPath = join(__dirname, "dist", "client", "sw.js");
      try {
        const content = readFileSync(swPath, "utf-8");
        writeFileSync(swPath, content.replace("__BUILD_VERSION__", version));
        console.log(`[sw-version] stamped sw.js with version: ${version}`);
      } catch {
        // sw.js not in dist — dev mode or build error, skip silently
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const apiPort = process.env.VITE_API_PORT || "3001";
  return {
    plugins: [react(), swVersionPlugin()],
    root: "client",
    build: {
      outDir: "../dist/client",
      emptyOutDir: true,
    },
    server: {
      allowedHosts: true,
      proxy: {
        "/ws": {
          target: `ws://localhost:${apiPort}`,
          ws: true,
        },
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
