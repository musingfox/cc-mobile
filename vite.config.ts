import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const apiPort = process.env.VITE_API_PORT || "3001";
  return {
    plugins: [react()],
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
