import { existsSync } from "node:fs";
import { createApp, DIST_DIR } from "./app";
import { parseServerConfig } from "./config";

const isProd = process.env.NODE_ENV === "production";
const serverConfig = parseServerConfig(process.argv);

createApp(serverConfig).listen({ port: serverConfig.port, hostname: serverConfig.hostname });

const servingStatic = existsSync(DIST_DIR);
console.log(
  `cc-mobile server listening on ${serverConfig.hostname}:${serverConfig.port}` +
    ` [${isProd ? "production" : "development"}${servingStatic ? ", serving static files" : ""}]`,
);
