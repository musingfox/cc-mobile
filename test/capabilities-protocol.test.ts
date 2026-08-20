import { describe, expect, test } from "bun:test";
import { ServerMessage } from "../server/protocol";

describe("Capabilities Protocol Extension", () => {
  test("retired capabilities snapshot is refused", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities",
      sessionId: "s1",
      agents: [{ name: "coder", description: "d" }],
      commands: [{ name: "/help", description: "h" }],
      model: "m1",
    });
    expect(result.success).toBe(false);
  });

  test("capabilities_list with AgentInfo and CommandInfo parses", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities_list",
      sessionId: "s1",
      agents: [{ name: "coder", description: "d" }],
      commands: [{ name: "/help", description: "h" }],
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "capabilities_list") {
      expect(result.data.agents).toEqual([{ name: "coder", description: "d" }]);
      expect(result.data.commands).toEqual([{ name: "/help", description: "h" }]);
    }
  });

  test("capabilities_list with name-only entries succeeds", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities_list",
      sessionId: "s1",
      agents: [{ name: "x" }],
      commands: [{ name: "/test" }],
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "capabilities_list") {
      expect(result.data.agents[0].description).toBeUndefined();
    }
  });

  test("malformed agents array is refused", () => {
    const result = ServerMessage.safeParse({
      type: "capabilities_list",
      sessionId: "s1",
      agents: [123],
      commands: [{ name: "/help" }],
    });
    expect(result.success).toBe(false);
  });
});
