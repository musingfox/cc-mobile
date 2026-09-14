import { describe, expect, test } from "bun:test";
import { pendingFromPermissionRequest } from "../services/ws-service";

/**
 * The kind the server read off the screen has to survive the frame being
 * unwrapped, because the card's wording depends on it — and an unparsed screen
 * must stay kindless rather than be filled in here.
 */
describe("QuestionKindReachesTheCard", () => {
  const frame = {
    type: "permission_request",
    sessionId: "p1",
    requestId: "r1",
    tool: { name: "A 或 B", parameters: { text: "這次要選 A 還是 B？" } },
    options: [{ id: "1", label: "A", keystroke: "1" }],
  };

  test("T1: a question frame reaches the card as a question", () => {
    const pending = pendingFromPermissionRequest({ ...frame, promptKind: "question" });

    expect(pending.requestId).toBe("r1");
    expect(pending.tool).toEqual({ name: "A 或 B", parameters: { text: "這次要選 A 還是 B？" } });
    expect(pending.options).toEqual([{ id: "1", label: "A", keystroke: "1" }]);
    expect(pending.promptKind).toBe("question");
  });

  test("T2: a frame without the key keeps its options and claims no kind", () => {
    const pending = pendingFromPermissionRequest(frame);

    expect(pending.promptKind).toBeUndefined();
    expect(pending.options).toHaveLength(1);
  });

  test("T3: an unknown kind is dropped, and missing options become Cancel-only", () => {
    const pending = pendingFromPermissionRequest({
      type: "permission_request",
      sessionId: "p1",
      requestId: "r1",
      tool: { name: "A 或 B", parameters: { text: "這次要選 A 還是 B？" } },
      promptKind: "whatever",
    });

    expect(pending.promptKind).toBeUndefined();
    expect(pending.options).toEqual([]);
  });
});
