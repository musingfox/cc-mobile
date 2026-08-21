import { describe, expect, test } from "bun:test";
import { selectConversationMessages } from "../services/conversation-mode";
import type { Message } from "../stores/app-store";

function msg(partial: Partial<Message> & Pick<Message, "id" | "role">): Message {
  return {
    content: "",
    timestamp: 1,
    ...partial,
  };
}

describe("ConversationModeSelection", () => {
  test("T1: one final answer per turn, end_turn of each segment", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const tu1 = msg({ id: "tu1", role: "assistant", stopReason: "tool_use", content: "x" });
    const tu2 = msg({ id: "tu2", role: "assistant", stopReason: "tool_use", content: "y" });
    const tu3 = msg({ id: "tu3", role: "assistant", stopReason: "tool_use", content: "z" });
    const end1 = msg({ id: "end1", role: "assistant", stopReason: "end_turn", content: "answer1" });
    const userB = msg({ id: "uB", role: "user", content: "B" });
    const end2 = msg({ id: "end2", role: "assistant", stopReason: "end_turn", content: "answer2" });
    const input = [userA, tu1, tu2, tu3, end1, userB, end2];
    expect(selectConversationMessages(input)).toEqual([userA, end1, userB, end2]);
  });

  test("T2: interrupted turn falls back to last text bubble in the segment", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const a1 = msg({ id: "a1", role: "assistant", stopReason: "tool_use", content: "first" });
    const a2 = msg({ id: "a2", role: "assistant", stopReason: "tool_use", content: "second" });
    const userB = msg({ id: "uB", role: "user", content: "B" });
    expect(selectConversationMessages([userA, a1, a2, userB])).toEqual([userA, a2, userB]);
  });

  test("T3: thinking and tool messages are never selected as a turn's answer", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const text = msg({ id: "text", role: "assistant", stopReason: "tool_use", content: "bubble" });
    const thinking = msg({ id: "th", role: "assistant", kind: "thinking", content: "plan" });
    const tool = msg({ id: "tool", role: "assistant", kind: "tool_use", toolName: "Bash", content: "" });
    const userB = msg({ id: "uB", role: "user", content: "B" });
    expect(selectConversationMessages([userA, text, thinking, tool, userB])).toEqual([userA, text, userB]);
  });

  test("T4: missing stopReason is a non-match absorbed by the fallback", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const assistant = msg({ id: "a", role: "assistant", content: "old record" });
    expect(selectConversationMessages([userA, assistant])).toEqual([userA, assistant]);
  });

  test("T5: omp stopReason stop with text is a turn-ending match", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const assistant = msg({ id: "a", role: "assistant", stopReason: "stop", content: "omp answer" });
    expect(selectConversationMessages([userA, assistant])).toEqual([userA, assistant]);
  });

  test("T6: omp stop with thinking and no text contributes no answer bubble", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const thinking = msg({
      id: "th",
      role: "assistant",
      stopReason: "stop",
      kind: "thinking",
      content: "hidden reasoning",
    });
    expect(selectConversationMessages([userA, thinking])).toEqual([userA]);
  });

  test("T7: a page that begins mid-turn treats the leading segment like any other", () => {
    const a1 = msg({ id: "a1", role: "assistant", content: "draft" });
    const end1 = msg({ id: "end1", role: "assistant", stopReason: "end_turn", content: "answer1" });
    const userB = msg({ id: "uB", role: "user", content: "B" });
    const end2 = msg({ id: "end2", role: "assistant", stopReason: "end_turn", content: "answer2" });
    expect(selectConversationMessages([a1, end1, userB, end2])).toEqual([end1, userB, end2]);
  });

  test("T8: unfinished trailing segment falls back to the in-progress text bubble", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const running = msg({ id: "a", role: "assistant", stopReason: "tool_use", content: "so far" });
    expect(selectConversationMessages([userA, running])).toEqual([userA, running]);
  });

  test("T9: last turn-ending match wins inside a segment", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const seq = msg({ id: "seq", role: "assistant", stopReason: "stop_sequence", content: "earlier" });
    const end = msg({ id: "end", role: "assistant", stopReason: "end_turn", content: "later" });
    expect(selectConversationMessages([userA, seq, end])).toEqual([userA, end]);
  });

  test("T10: compact_boundary and permission_denied survive and do not open or close a segment", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const compact = msg({ id: "c", role: "assistant", kind: "compact_boundary", content: "compacted" });
    const denied = msg({ id: "d", role: "user", kind: "permission_denied", content: "denied" });
    const end = msg({ id: "end", role: "assistant", stopReason: "end_turn", content: "answer" });
    const userB = msg({ id: "uB", role: "user", content: "B" });
    expect(selectConversationMessages([userA, compact, denied, end, userB])).toEqual([
      userA,
      compact,
      denied,
      end,
      userB,
    ]);
  });

  test("T11: local-only optimistic user echo is kept and opens a new segment", () => {
    const userA = msg({ id: "uA", role: "user", content: "A", recordId: "r1" });
    const end = msg({ id: "end", role: "assistant", stopReason: "end_turn", content: "answer" });
    const echo = msg({ id: "echo", role: "user", content: "just sent" });
    expect(selectConversationMessages([userA, end, echo])).toEqual([userA, end, echo]);
  });

  test("T13: a tool_result is neither an answer nor a prompt, and does not split the turn", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const use = msg({ id: "tu", role: "assistant", kind: "tool_use", toolName: "Bash", content: "" });
    // The projection gives a tool_result role "user" (transcript-projection.ts
    // roleForPart), which is why role alone cannot decide what a prompt is.
    const result = msg({ id: "tr", role: "user", kind: "tool_result", content: "stdout blah" });
    const end = msg({ id: "end", role: "assistant", stopReason: "end_turn", content: "answer" });
    expect(selectConversationMessages([userA, use, result, end])).toEqual([userA, end]);
  });

  test("T12: pure — same input yields equal output and input is not mutated", () => {
    const userA = msg({ id: "uA", role: "user", content: "A" });
    const end = msg({ id: "end", role: "assistant", stopReason: "end_turn", content: "answer" });
    const input = [userA, end];
    const snapshot = structuredClone(input);
    const first = selectConversationMessages(input);
    const second = selectConversationMessages(input);
    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
  });
});
