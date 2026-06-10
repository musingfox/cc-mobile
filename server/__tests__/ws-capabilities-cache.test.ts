import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCachedCapabilities } from "../ws";

describe("WebSocket capabilities cache wiring", () => {
  test("C2-TC1: cached capabilities include models/accountInfo when init data exists", () => {
    const cached = buildCachedCapabilities(
      {
        slash_commands: [{ name: "a" }],
        agents: [{ name: "agent-a" }],
        model: "claude-sonnet-4-6",
      },
      {
        models: [{ value: "x", displayName: "X", description: "" }],
        account: { email: "e@x" },
      },
    );

    expect(cached).toEqual({
      commands: [{ name: "a" }],
      agents: [{ name: "agent-a" }],
      model: "claude-sonnet-4-6",
      models: [{ value: "x", displayName: "X", description: "" }],
      accountInfo: { email: "e@x" },
    });
  });

  test("C2-TC2: cached capabilities stay old shape when init data is absent", () => {
    const cached = buildCachedCapabilities(
      {
        slash_commands: [],
        agents: [],
        model: "m",
      },
      null,
    );

    expect(cached).toEqual({ commands: [], agents: [], model: "m" });
  });

  test("C2 wiring: reconnect/resume sends spread cached capabilities", () => {
    const wsSource = readFileSync(join(import.meta.dir, "..", "ws.ts"), "utf8");
    // open/reconnect path: type:"capabilities" immediately followed by ...cachedCapabilities (whitespace-insensitive)
    expect(wsSource).toMatch(/type:\s*"capabilities",\s*\.\.\.cachedCapabilities,/);
    // resume path: type:"capabilities" followed by bare sessionId then ...cachedCapabilities
    // "bare sessionId," means `sessionId,` on its own (not `sessionId: something,`)
    expect(wsSource).toMatch(/type:\s*"capabilities",\s*sessionId,\s*\.\.\.cachedCapabilities,/);
  });
});
