import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5199",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "bun run e2e/start-mock-server.ts",
      port: 3099,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bunx vite --port 5199 --strictPort",
      port: 5199,
      reuseExistingServer: !process.env.CI,
      env: {
        // Vite proxy target must point to mock server
        VITE_API_PORT: "3099",
      },
    },
  ],
});
