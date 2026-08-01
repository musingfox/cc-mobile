import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  it("no longer tracks process ownership that nothing reads", () => {
    expect(wsSource).not.toContain("ptySessionIds");
  });
});

describe("ws.ts is a pure transport module", () => {
  it("touches no filesystem", () => {
    expect(wsSource).not.toContain("node:fs");
  });

  it("validates every client message through the single Zod entry point", () => {
    expect(wsSource).toContain("ClientMessage.safeParse");
    // The hand-rolled tmux_create/tmux_teardown branch read the raw payload
    // ahead of the Zod gate. Nothing may parse before safeParse again.
    expect(wsSource).not.toContain("raw.type ===");
  });

  it("holds no untyped module-level socket reference", () => {
    expect(wsSource).not.toContain("wsRef");
  });

  it("assembles nothing — collaborators are injected by the composition root", () => {
    expect(wsSource).not.toContain("new EventBuffer");
    expect(wsSource).not.toContain("new PtyOrchestrator");
    expect(wsSource).not.toContain('process.on("SIGTERM"');
  });
});
