import { existsSync } from "node:fs";
import { type AppBackend, createApp, DIST_DIR } from "./app";
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

const backendRef: { current: AppBackend | null } = { current: null };
const app = createApp(serverConfig, { backendRef });

// Panes now outlive a stop, so the sessions still alive in the daemon are
// rediscovered before anything is served: a client that reconnects and asks for
// the live session list must not race a scan that has not finished, or it would
// be told its still-running session is gone. Fatal on failure, like the gate
// above — an unreadable daemon leaves every live pane stranded.
try {
  const report = await backendRef.current?.remountLiveSessions?.();
  if (report) {
    console.log(
      `[herdr] remount: ${report.adopted.length} adopted, ` +
        `${report.reaped.length} reaped, ${report.skipped.length} skipped`,
    );
  }
} catch (error) {
  console.error(`herdr remount failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

app.listen({ port: serverConfig.port, hostname: serverConfig.hostname });

const servingStatic = existsSync(DIST_DIR);
console.log(
  `cc-mobile server listening on ${serverConfig.hostname}:${serverConfig.port}` +
    ` [${isProd ? "production" : "development"}${servingStatic ? ", serving static files" : ""}]`,
);
