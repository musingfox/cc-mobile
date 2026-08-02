import { existsSync } from "node:fs";
import { createApp, DIST_DIR } from "./app";
import { parseServerConfig } from "./config";
import { verifyHerdrStartup } from "./herdr/backend";

const isProd = process.env.NODE_ENV === "production";
const serverConfig = parseServerConfig(process.argv);

// Wrapped rather than top-level await: pm2's bun fork container loads this file
// with require(), which rejects an async module.
async function main(): Promise<void> {
  // Terminal sessions run entirely through herdr, with no fallback backend, so an
  // unreachable or incompatible daemon is fatal here rather than on the user's
  // first tap. Nothing has been listened on yet — this exits before binding.
  try {
    await verifyHerdrStartup();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // No startup rediscovery scan: the session list is derived live from the
  // daemon on every `list_terminal_sessions` (Decision M12), so there is nothing
  // to rebuild before serving and no window in which a client can race it.
  const app = createApp(serverConfig);

  app.listen({ port: serverConfig.port, hostname: serverConfig.hostname });

  const servingStatic = existsSync(DIST_DIR);
  console.log(
    `cc-mobile server listening on ${serverConfig.hostname}:${serverConfig.port}` +
      ` [${isProd ? "production" : "development"}${servingStatic ? ", serving static files" : ""}]`,
  );
}

void main();
