import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { FullModeThinking, mergeToolParts } from "../services/conversation-mode";
import type { Message } from "../stores/app-store";

function msg(partial: Partial<Message> & Pick<Message, "id" | "role">): Message {
  return {
    content: "",
    timestamp: 1,
    ...partial,
  };
}

describe("FullModeToolActivity", () => {
  afterEach(() => {
    cleanup();
  });

  test("T1: tool_use and matching tool_result become one tool card", () => {
    const use = msg({
      id: "use",
      role: "assistant",
      kind: "tool_use",
      toolUseId: "tu_1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });
    const result = msg({
      id: "res",
      role: "user",
      kind: "tool_result",
      toolUseId: "tu_1",
      content: "a\nb",
    });
    const out = mergeToolParts([use, result]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("tool");
    expect(out[0].toolName).toBe("Bash");
    expect(out[0].toolInput).toEqual({ command: "ls" });
    expect(out[0].content).toBe("a\nb");
  });

  test("T2: outstanding tool_use renders a card with empty content", () => {
    const use = msg({
      id: "use",
      role: "assistant",
      kind: "tool_use",
      toolUseId: "tu_live",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });
    const out = mergeToolParts([use]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("tool");
    expect(out[0].toolName).toBe("Bash");
    expect(out[0].content).toBe("");
  });

  test("T3: orphaned tool_result still renders as Tool result", () => {
    const result = msg({
      id: "res",
      role: "user",
      kind: "tool_result",
      toolUseId: "tu_missing",
      content: "orphan body",
    });
    const out = mergeToolParts([result]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("tool");
    expect(out[0].toolName).toBe("Tool result");
    expect(out[0].content).toBe("orphan body");
  });

  test("T4: pairing is recomputed from scratch when the missing tool_use is prepended", () => {
    const result = msg({
      id: "res",
      role: "user",
      kind: "tool_result",
      toolUseId: "tu_1",
      content: "a\nb",
    });
    const orphan = mergeToolParts([result]);
    expect(orphan[0].toolName).toBe("Tool result");

    const use = msg({
      id: "use",
      role: "assistant",
      kind: "tool_use",
      toolUseId: "tu_1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });
    const paired = mergeToolParts([use, result]);
    expect(paired).toHaveLength(1);
    expect(paired[0].toolName).toBe("Bash");
    expect(paired[0].toolInput).toEqual({ command: "ls" });
    expect(paired[0].content).toBe("a\nb");
  });

  test("T5: two toolUseIds become two cards with no cross-matching", () => {
    const use1 = msg({
      id: "u1",
      role: "assistant",
      kind: "tool_use",
      toolUseId: "tu_1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });
    const use2 = msg({
      id: "u2",
      role: "assistant",
      kind: "tool_use",
      toolUseId: "tu_2",
      toolName: "Read",
      toolInput: { path: "a.ts" },
    });
    const res1 = msg({
      id: "r1",
      role: "user",
      kind: "tool_result",
      toolUseId: "tu_1",
      content: "listed",
    });
    const res2 = msg({
      id: "r2",
      role: "user",
      kind: "tool_result",
      toolUseId: "tu_2",
      content: "file",
    });
    const out = mergeToolParts([use1, use2, res1, res2]);
    expect(out).toHaveLength(2);
    expect(out[0].toolName).toBe("Bash");
    expect(out[0].content).toBe("listed");
    expect(out[1].toolName).toBe("Read");
    expect(out[1].content).toBe("file");
  });

  test("T6: no tool parts — value-equal output and input not mutated", () => {
    const user = msg({ id: "u", role: "user", content: "hi" });
    const assistant = msg({ id: "a", role: "assistant", content: "hello" });
    const input = [user, assistant];
    const snapshot = structuredClone(input);
    const out = mergeToolParts(input);
    expect(out).toEqual(input);
    expect(input).toEqual(snapshot);
  });

  test("T7: thinking is collapsed by default; text lives inside a native disclosure", () => {
    const reasoning = "a long chain of reasoning that must not push the answer off screen";
    const { container, getByText } = render(createElement(FullModeThinking, { text: reasoning }));
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain(reasoning);
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    fireEvent.click(summary!);
    expect(details?.open).toBe(true);
    expect(getByText(reasoning)).not.toBeNull();
  });

  test("T8: Full mode on a plain conversation adds nothing", () => {
    const user = msg({ id: "u", role: "user", content: "hi" });
    const assistant = msg({ id: "a", role: "assistant", content: "hello" });
    const input = [user, assistant];
    expect(mergeToolParts(input)).toEqual(input);
  });
});
