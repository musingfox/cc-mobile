import { describe, expect, test } from "bun:test";
import { pendingFromPermissionRequest, permissionResolution } from "../services/ws-service";

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

/**
 * History wording: a question's answer is not an approval. `recordPermissionAction`
 * already accepted "answered"; nothing used to reach it.
 */
describe("permissionResolution", () => {
  const options = [
    { id: "1", label: "A" },
    { id: "2", label: "No thanks" },
  ];

  test("a question's chosen answer is recorded as answered, whatever it says", () => {
    expect(permissionResolution({ promptKind: "question", options }, "1")).toBe("answered");
    // "No thanks" is an answer on a question, not a refusal.
    expect(permissionResolution({ promptKind: "question", options }, "2")).toBe("answered");
  });

  test("cancelling a question is still a refusal", () => {
    expect(permissionResolution({ promptKind: "question", options }, "cancel")).toBe("denied");
  });

  test("a permission prompt keeps the label test it has always used", () => {
    expect(permissionResolution({ promptKind: "permission", options }, "1")).toBe("approved");
    expect(permissionResolution({ promptKind: "permission", options }, "2")).toBe("denied");
    expect(permissionResolution({ options }, "cancel")).toBe("denied");
  });
});
