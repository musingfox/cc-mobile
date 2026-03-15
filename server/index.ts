import { Elysia } from "elysia";
import { SessionManager } from "./session-manager";
import { createPermissionHandler } from "./permission-bridge";
import { createWsPlugin } from "./ws";
import { parseServerConfig } from "./config";

const serverConfig = parseServerConfig(process.argv);
const sessionManager = new SessionManager({ permissionMode: serverConfig.permissionMode });

const app = new Elysia()
  .use(createWsPlugin(sessionManager, createPermissionHandler, serverConfig))
  .listen({ port: serverConfig.port, hostname: serverConfig.hostname });

console.log(`cc-touch server listening on ${serverConfig.hostname}:${serverConfig.port}`);
