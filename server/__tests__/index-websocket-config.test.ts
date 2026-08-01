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
    expect(indexSource).toContain("createApp(serverConfig).listen(");
  });
});
