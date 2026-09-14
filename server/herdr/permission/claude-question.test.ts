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

  test("a lower-case Submit in the chip row still refuses the screen", () => {
    // The guard decides whether a digit is an answer or a step in a sequence.
    // Casing is claude's to change, so it must not be what the refusal hangs on.
    // Built from the single-select capture so the arrow glyphs cannot carry the
    // refusal on their own — the word is the only thing left to catch it.
    const lowered = singleSelect.replace(" ☐ A 或 B", " ☐ A 或 B  ✔ submit");

    expect(lowered).toContain("✔ submit");
    expect(lowered).not.toContain("←");
    expect(parseBlockedPrompt({ text: lowered })).toBeNull();
  });

  test("an alternate cursor glyph still yields both answers, not half the card", () => {
    // A caret this line-matcher does not know demotes its option into the
    // question text and offers the rest — a half card is worse than no card.
    const altCursor = singleSelect.replace("❯ 1. A", "› 1. A");

    expect(altCursor).toContain("› 1. A");
    expect(parseBlockedPrompt({ text: altCursor })?.options).toEqual([
      { id: "1", label: "A", keystroke: "1" },
      { id: "2", label: "B", keystroke: "2" },
    ]);
  });

  test("a title carrying the word or an arrow is still a question, not a sequence", () => {
    // The chip row's text after the glyph is the model's own wording. Refusing
    // on it would not merely hide the card: an unparsed screen is Cancel-only
    // AND still armed, so the 90-second esc would cancel a real question.
    for (const title of ["Submit PR?", "v1 → v2"]) {
      const titled = singleSelect.replace(" ☐ A 或 B", ` ☐ ${title}`);

      expect(parseBlockedPrompt({ text: titled })?.options).toEqual([
        { id: "1", label: "A", keystroke: "1" },
        { id: "2", label: "B", keystroke: "2" },
      ]);
    }
  });

  test("output above a clipped box top is not mistaken for the question box", () => {
    // A short pane can push the real box top out of the capture. If an older
    // rule sits within the lookback, the region fills with ordinary output —
    // and claude's own markdown lists read as options to any digit matcher.
    const lines = singleSelect.split("\n");
    const firstRule = lines.findIndex((line) => /^\s*─{20,}\s*$/.test(line));
    const clipped = [
      "──────────────────────────────────────────",
      "⏺ Update(README.md)",
      "  1. alpha",
      "  2. beta",
      ...lines.slice(firstRule + 1),
    ].join("\n");

    expect(parseBlockedPrompt({ text: clipped })).toBeNull();
  });

  test("question wording that opens with a number does not become an answer", () => {
    // `1. 還是 2.？` matches the option shape, and taking it would shift every
    // real answer's digit away from the one printed beside it.
    // replaceAll: the capture prints the question twice, and only the copy
    // inside the box is in the parsed region.
    const numbered = singleSelect.replaceAll("這次要選 A 還是 B？", "1. 還是 2.？");

    expect(numbered).toContain("1. 還是 2.？");
    expect(parseBlockedPrompt({ text: numbered })).toBeNull();
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
