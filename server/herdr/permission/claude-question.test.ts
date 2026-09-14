/**
 * ClaudeQuestionParse — claude's AskUserQuestion screen becomes tappable options.
 *
 * The fixture is a verbatim `pane.read` capture of a live claude asking a
 * single-select question, kept byte-for-byte: the box rules, the header chip
 * glyph and the trailing footer are all load-bearing screen text, not prose
 * this test may tidy.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlockedPrompt } from "./prompt-parse";

const FIXTURES = join(import.meta.dir, "fixtures");
const singleSelect = readFileSync(join(FIXTURES, "claude-ask-user-question.txt"), "utf8");

describe("ClaudeQuestionParse", () => {
  test("offers exactly the two real answers, not the free-text or chat rows", () => {
    const parsed = parseBlockedPrompt({ text: singleSelect });

    // "3. Type something." opens a text field a digit cannot fill, and
    // "4. Chat about this" lives below the mid rule — neither is an answer.
    expect(parsed?.options).toEqual([
      { id: "1", label: "A", keystroke: "1" },
      { id: "2", label: "B", keystroke: "2" },
    ]);
  });

  test("reads the header chip as the title and the line above the options as the question", () => {
    const parsed = parseBlockedPrompt({ text: singleSelect });

    expect(parsed?.toolLabel).toBe("A 或 B");
    expect(parsed?.argumentText).toBe("這次要選 A 還是 B？");
    // A question screen carries no separate one-line summary to show.
    expect(parsed?.description).toBeUndefined();
  });

  test("says it is a question drawn by claude, and fingerprints it", () => {
    const parsed = parseBlockedPrompt({ text: singleSelect });

    expect(parsed?.promptKind).toBe("question");
    expect(parsed?.dialect).toBe("claude");
    expect(parsed?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  test("a screen whose box top scrolled off parses as nothing", () => {
    // Without the rule above the header chip there is no upper bound to the
    // region, and everything above it is ordinary conversation.
    const lines = singleSelect.split("\n");
    const boxTop = lines.findIndex((line) => /^\s*─{20,}\s*$/.test(line));
    lines.splice(boxTop, 1);

    expect(parseBlockedPrompt({ text: lines.join("\n") })).toBeNull();
  });
});
