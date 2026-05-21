import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const wsSource = readFileSync(join(import.meta.dir, "..", "ws.ts"), "utf8");

describe("WsData shape", () => {
  it("only keeps per-socket session tracking", () => {
    const removedField = "heart" + "beat?:";
    expect(wsSource).toContain("interface WsData");
    expect(wsSource).toContain("currentSessionId?: string;");
    expect(wsSource).not.toContain(removedField);
  });

  it("does not import the removed ping manager", () => {
    expect(wsSource).not.toContain("HeartbeatManager");
  });

  it("does not emit app-level ping messages", () => {
    expect(wsSource).not.toContain('type: "ping"');
  });
});
