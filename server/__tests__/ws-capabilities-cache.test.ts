import { describe, expect, test } from "bun:test";
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
});
