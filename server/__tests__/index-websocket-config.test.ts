import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Elysia instance moved from the top-level index.ts script into the
// createApp composition root, so the keep-alive config is anchored there now.
const appSource = readFileSync(join(import.meta.dir, "..", "app.ts"), "utf8");
const indexSource = readFileSync(join(import.meta.dir, "..", "index.ts"), "utf8");

describe("server websocket keep-alive config", () => {
  it("defines a named 240s websocket idle timeout constant", () => {
    expect(appSource).toContain("export const WS_IDLE_TIMEOUT_SECONDS = 240;");
  });

  it("constructs Elysia with websocket idleTimeout and sendPings enabled", () => {
    expect(appSource).toMatch(
      /new Elysia\(\{\s*websocket:\s*\{\s*idleTimeout:\s*WS_IDLE_TIMEOUT_SECONDS,\s*sendPings:\s*true,\s*\},\s*\}\)/s,
    );
  });

  it("keeps assembly out of the top-level entry script", () => {
    expect(indexSource).not.toContain("new Elysia");
    expect(indexSource).toContain("createApp(serverConfig");
    expect(indexSource).toContain(".listen(");
  });

  it("runs no startup rediscovery scan, only the daemon gate, before listening", () => {
    // The session list is a live `agent.list` query (Decision M12), so startup
    // has nothing to rebuild — and no scan a reconnecting client could race.
    const verifyAt = indexSource.indexOf("verifyHerdrStartup");
    const listenAt = indexSource.indexOf("app.listen(");
    expect(indexSource).not.toContain("remountLiveSessions");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(listenAt);
  });
});
