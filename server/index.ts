import { existsSync } from "node:fs";
import { type AppBackend, createApp, DIST_DIR } from "./app";
import { parseServerConfig } from "./config";
import { verifyHerdrSides } from "./herdr/backend";
import { resolveHerdrSides } from "./herdr/sides";

const isProd = process.env.NODE_ENV === "production";
const serverConfig = parseServerConfig(process.argv);

// Wrapped rather than top-level await: pm2's bun fork container loads this file
// with require(), which rejects an async module.
async function main(): Promise<void> {
  // Terminal sessions run entirely through herdr, with no fallback backend, so a
  // daemon that answered and speaks another protocol is fatal here rather than
  // on the user's first tap. An unreachable one is only warned about: the
  // server listens anyway and the background watch retries it (ADR-018).
  // Nothing has been listened on yet — this exits before binding.
  try {
    await verifyHerdrSides(resolveHerdrSides(serverConfig.hangarSession ?? null));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // No startup rediscovery scan: the session list is derived live from the
  // daemon on every `list_terminal_sessions` (Decision M12), so there is nothing
  // to rebuild before serving and no window in which a client can race it.
  const backendRef: { current: AppBackend | null } = { current: null };
  const app = createApp(serverConfig, { backendRef });

  app.listen({ port: serverConfig.port, hostname: serverConfig.hostname });
  // Opens the daemon subscriptions and watches now, not on the first phone.
  const backend = backendRef.current;
  if (backend?.start) backend.start();

  const servingStatic = existsSync(DIST_DIR);
  console.log(
    `cc-mobile server listening on ${serverConfig.hostname}:${serverConfig.port}` +
      ` [${isProd ? "production" : "development"}${servingStatic ? ", serving static files" : ""}]`,
  );
}

void main();
