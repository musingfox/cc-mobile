import { existsSync } from "node:fs";
import { createApp, DIST_DIR } from "./app";
import { parseServerConfig } from "./config";
import { verifyHerdrStartup } from "./herdr/backend";

const isProd = process.env.NODE_ENV === "production";
const serverConfig = parseServerConfig(process.argv);

// Terminal sessions run entirely through herdr, with no fallback backend, so an
// unreachable or incompatible daemon is fatal here rather than on the user's
// first tap. Nothing has been listened on yet — this exits before binding.
try {
  await verifyHerdrStartup();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

createApp(serverConfig).listen({ port: serverConfig.port, hostname: serverConfig.hostname });

const servingStatic = existsSync(DIST_DIR);
console.log(
  `cc-mobile server listening on ${serverConfig.hostname}:${serverConfig.port}` +
    ` [${isProd ? "production" : "development"}${servingStatic ? ", serving static files" : ""}]`,
);
