/**
 * Starts the real Elysia server with a MockSessionManager.
 * Used by Playwright e2e tests via `webServer` config.
 *
 * Usage: bun run e2e/start-mock-server.ts
 */
import { Elysia } from "elysia";
import type { ServerConfig } from "../server/config";
import { createPermissionHandler } from "../server/permission-bridge";
import { createWsPlugin } from "../server/ws";
import agentSequence from "./fixtures/agent-sequence.json";
import chatSequence from "./fixtures/chat-sequence.json";
import permissionFlow from "./fixtures/permission-flow.json";
import toolUseSequence from "./fixtures/tool-use-sequence.json";
import { MockSessionManager } from "./mock-session-manager";

const PORT = 3099; // Different from dev server (3001)

const mockSessionManager = new MockSessionManager({
  fixtures: {
    tool: toolUseSequence,
    agent: agentSequence,
    hello: chatSequence,
    permission: permissionFlow,
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

new Elysia()
  .use(
    createWsPlugin(
      mockSessionManager as Parameters<typeof createWsPlugin>[0],
      createPermissionHandler,
      serverConfig,
    ),
  )
  .listen({ port: PORT, hostname: "localhost" });

console.log(`[mock-server] listening on localhost:${PORT}`);
