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
const multiSelect = readFileSync(join(FIXTURES, "claude-ask-multiselect.txt"), "utf8");
const stepper = readFileSync(join(FIXTURES, "claude-ask-stepper.txt"), "utf8");

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

/**
 * The two screens whose answer is a sequence rather than a keystroke. Both are
 * verbatim captures, and both must reach the phone as the raw screen plus a
 * Cancel — a card of digits would toggle a checkbox or walk to the wrong
 * question instead of answering.
 */
describe("ClaudeQuestionVariantRefusal", () => {
  test("a multiSelect question is not turned into tappable options", () => {
    expect(parseBlockedPrompt({ text: multiSelect })).toBeNull();
  });

  test("a multi-question stepper is refused even though its options look single-select", () => {
    // Its option rows are drawn identically to the single-select fixture's, so
    // the checkbox shape alone would let this one through: the header chip's
    // "✔ Submit" is what says the answer is not one digit.
    expect(stepper).toContain("✔ Submit");
    expect(parseBlockedPrompt({ text: stepper })).toBeNull();
  });

  test("the checkbox shape refuses a multiSelect whose header gave nothing away", () => {
    const headerless = multiSelect.replace("←  ", "").replace("  ✔ Submit  →", "");

    expect(headerless).not.toContain("Submit  →");
    expect(parseBlockedPrompt({ text: headerless })).toBeNull();
  });

  test("a question with nothing but the free-text row parses as nothing", () => {
    const noAnswers = singleSelect
      .replace("❯ 1. A\n", "")
      .replace("     選擇 A\n", "")
      .replace("  2. B\n", "")
      .replace("     選擇 B\n", "");

    expect(noAnswers).not.toContain("選擇 A");
    expect(parseBlockedPrompt({ text: noAnswers })).toBeNull();
  });
});
