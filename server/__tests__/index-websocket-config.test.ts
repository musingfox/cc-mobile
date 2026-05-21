import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const indexSource = readFileSync(join(import.meta.dir, "..", "index.ts"), "utf8");

describe("server websocket keep-alive config", () => {
  it("defines a named 240s websocket idle timeout constant", () => {
    expect(indexSource).toContain("export const WS_IDLE_TIMEOUT_SECONDS = 240;");
  });

  it("constructs Elysia with websocket idleTimeout and sendPings enabled", () => {
    expect(indexSource).toMatch(
      /new Elysia\(\{\s*websocket:\s*\{\s*idleTimeout:\s*WS_IDLE_TIMEOUT_SECONDS,\s*sendPings:\s*true,\s*\},\s*\}\)/s,
    );
  });
});
