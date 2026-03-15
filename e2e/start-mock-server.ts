/**
 * Starts the real Elysia server with a MockSessionManager.
 * Used by Playwright e2e tests via `webServer` config.
 *
 * Usage: bun run e2e/start-mock-server.ts
 */
import { Elysia } from "elysia";
import { createWsPlugin } from "../server/ws";
import { createPermissionHandler } from "../server/permission-bridge";
import { MockSessionManager } from "./mock-session-manager";
import type { ServerConfig } from "../server/config";
import toolUseSequence from "./fixtures/tool-use-sequence.json";
import agentSequence from "./fixtures/agent-sequence.json";

const PORT = 3099; // Different from dev server (3001)

const mockSessionManager = new MockSessionManager({
  fixtures: {
    tool: toolUseSequence,
    agent: agentSequence,
  },
  defaultFixture: "tool",
  eventDelay: 30,
});

const serverConfig: ServerConfig = {
  port: PORT,
  hostname: "localhost",
  defaultCwd: null,
  permissionMode: "default",
  allowedRoots: null,
};

const app = new Elysia()
  .use(createWsPlugin(
    mockSessionManager as any,
    createPermissionHandler,
    serverConfig,
  ))
  .listen({ port: PORT, hostname: "localhost" });

console.log(`[mock-server] listening on localhost:${PORT}`);
