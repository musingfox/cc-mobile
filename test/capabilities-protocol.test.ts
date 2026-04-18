import { describe, expect, test } from "bun:test";
import { ServerMessage } from "../server/protocol";

describe("Capabilities Protocol Extension", () => {
  test("T4.1: new format with AgentInfo and CommandInfo parses correctly", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      agents: [{ name: "coder", description: "d" }],
      commands: [{ name: "/help", description: "h" }],
      model: "m1",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents).toEqual([{ name: "coder", description: "d" }]);
      expect(result.data.commands).toEqual([{ name: "/help", description: "h" }]);
    }
  });

  test("T4.2: old format with string arrays transforms to object arrays", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      agents: ["coder"],
      commands: ["/help"],
      model: "m1",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents).toEqual([{ name: "coder" }]);
      expect(result.data.commands).toEqual([{ name: "/help" }]);
    }
  });

  test("T4.3: new format with partial AgentInfo (name only) succeeds", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      agents: [{ name: "x" }],
      commands: [{ name: "/test" }],
      model: "m1",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0].description).toBeUndefined();
    }
  });

  test("T4.4: malformed agents array throws ZodError", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      agents: [123],
      commands: ["/help"],
      model: "m1",
    });

    expect(result.success).toBe(false);
  });
});
