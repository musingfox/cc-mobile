/**
 * Starts the real Elysia server with a MockSessionManager.
 * Used by Playwright e2e tests via `webServer` config.
 *
 * Usage: bun run e2e/start-mock-server.ts
 */
import { createApp } from "../server/app";
import type { ServerConfig } from "../server/config";
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
  basePath: "",
};

type AppDeps = NonNullable<Parameters<typeof createApp>[1]>;

createApp(serverConfig, {
  // MockSessionManager implements the slice of SessionManager the WS plugin
  // calls, not the whole class — the same narrowing cast the createWsPlugin
  // call site used before assembly moved into createApp.
  sessionManager: mockSessionManager as unknown as AppDeps["sessionManager"],
}).listen({ port: PORT, hostname: "localhost" });

console.log(`[mock-server] listening on localhost:${PORT}`);
