import { Elysia } from "elysia";
import { SessionManager } from "./session-manager";
import { createPermissionHandler } from "./permission-bridge";
import { createWsPlugin } from "./ws";

const sessionManager = new SessionManager();

const app = new Elysia()
  .use(createWsPlugin(sessionManager, createPermissionHandler))
  .listen(3001);

console.log("cc-touch server listening on :3001");
