import { describe, expect, test } from "bun:test";
import { ClientMessage } from "../protocol";

describe("stop_task ClientMessage schema", () => {
  test("valid message parses", () => {
    const result = ClientMessage.safeParse({
      type: "stop_task",
      sessionId: "s1",
      taskId: "t1",
    });
    expect(result.success).toBe(true);
  });

  test("missing taskId fails", () => {
    const result = ClientMessage.safeParse({
      type: "stop_task",
      sessionId: "s1",
    });
    expect(result.success).toBe(false);
  });

  test("missing sessionId fails", () => {
    const result = ClientMessage.safeParse({
      type: "stop_task",
      taskId: "t1",
    });
    expect(result.success).toBe(false);
  });
});
