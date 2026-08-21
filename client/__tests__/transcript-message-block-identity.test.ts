import { beforeEach, describe, expect, test } from "bun:test";
import type { Message } from "../stores/app-store";
import { useAppStore } from "../stores/app-store";

function session(sessionId = "s1") {
  const state = useAppStore.getState().sessions.get(sessionId);
  if (!state) throw new Error(`no session ${sessionId}`);
  return state;
}

function apply(...args: Parameters<ReturnType<typeof useAppStore.getState>["applyTranscriptMessages"]>) {
  useAppStore.getState().applyTranscriptMessages(...args);
}

function threeParts(recordId: string, seq: number, text = "answer"): Message[] {
  return [
    {
      id: `id-${recordId}-0`,
      role: "assistant",
      content: "plan",
      timestamp: 1,
      recordId,
      seq,
      blockIndex: 0,
      kind: "thinking",
    },
    {
      id: `id-${recordId}-1`,
      role: "assistant",
      content: "",
      timestamp: 1,
      recordId,
      seq,
      blockIndex: 1,
      kind: "tool_use",
      toolName: "Read",
    },
    {
      id: `id-${recordId}-2`,
      role: "assistant",
      content: text,
      timestamp: 1,
      recordId,
      seq,
      blockIndex: 2,
    },
  ];
}

beforeEach(() => {
  useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  useAppStore.getState().addSession("s1", "/cwd");
});

describe("MessageIdentityByBlock", () => {
  test("T2: a 3-part record applied twice holds 3 messages not 6", () => {
    const parts = threeParts("r1", 100);
    apply("s1", { epoch: "aaaa", messages: parts });
    apply(
      "s1",
      {
        epoch: "aaaa",
        messages: parts.map((m, i) => ({ ...m, id: `replay-${i}` })),
      },
    );
    expect(session().messages).toHaveLength(3);
    expect(session().messages.map((m) => m.blockIndex)).toEqual([0, 1, 2]);
  });

  test("T3: second arrival's longer text follows newer body; first id survives; thinking/tool untouched", () => {
    apply("s1", { epoch: "aaaa", messages: threeParts("r1", 100, "short") });
    const firstIds = session().messages.map((m) => m.id);
    const thinkingContent = session().messages[0].content;
    const toolName = session().messages[1].toolName;
    apply("s1", { epoch: "aaaa", messages: threeParts("r1", 100, "a much longer answer") });
    expect(session().messages).toHaveLength(3);
    expect(session().messages[2].content).toBe("a much longer answer");
    expect(session().messages[2].id).toBe(firstIds[2]);
    expect(session().messages[0].content).toBe(thinkingContent);
    expect(session().messages[1].toolName).toBe(toolName);
    expect(session().messages[0].id).toBe(firstIds[0]);
    expect(session().messages[1].id).toBe(firstIds[1]);
  });

  test("T4: equal seqs keep blockIndex order after stable sort", () => {
    apply("s1", { epoch: "aaaa", messages: threeParts("r1", 50) });
    expect(session().messages.map((m) => m.blockIndex)).toEqual([0, 1, 2]);
    expect(session().messages.map((m) => m.kind)).toEqual(["thinking", "tool_use", undefined]);
  });

  test("T5: C4 duplicate recordId at two byte offsets keeps earlier seq per block", () => {
    apply("s1", { epoch: "aaaa", messages: threeParts("dup", 100).slice(0, 2) });
    apply(
      "s1",
      {
        epoch: "aaaa",
        messages: threeParts("dup", 90000).slice(0, 2).map((m) => ({ ...m, id: `later-${m.blockIndex}` })),
      },
    );
    expect(session().messages).toHaveLength(2);
    expect(session().messages.every((m) => m.seq === 100)).toBe(true);
  });

  test("T6: local-only message is not merged and sorts below transcript", () => {
    apply("s1", { epoch: "aaaa", messages: threeParts("r1", 10) });
    apply("s1", {
      epoch: "aaaa",
      messages: [{ id: "local", role: "user", content: "echo", timestamp: 9 }],
    });
    expect(session().messages).toHaveLength(4);
    expect(session().messages[3].id).toBe("local");
    expect(session().messages.filter((m) => m.id === "local")).toHaveLength(1);
  });
});
