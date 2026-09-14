/**
 * claude-question.ts — claude's AskUserQuestion screen, turned into options the
 * phone can tap.
 *
 * A separate file from prompt-parse.ts for the same reason omp-prompt.ts is:
 * nothing about this screen is the permission prompt with different words. The
 * permission prompt announces itself with "Do you want to proceed?" and prints
 * its options *below* that marker; this screen has no marker of its own at the
 * top at all. What it does have is a fixed last option — "Chat about this" —
 * drawn under a rule that separates it from the real answers:
 *
 *     ─────────────────────────────────────────────   <- box top
 *      ☐ A 或 B                                       <- header chip
 *
 *     這次要選 A 還是 B？                              <- the question
 *
 *     ❯ 1. A
 *          選擇 A
 *       2. B
 *          選擇 B
 *       3. Type something.
 *     ─────────────────────────────────────────────   <- mid rule
 *       4. Chat about this
 *
 *     Enter to select · ↑/↓ to navigate · Esc to cancel
 *
 * So the anchor is at the bottom and the region is read *upwards* from it,
 * through the mid rule, up to the box top. Walking downwards from a marker —
 * the shape prompt-parse.ts uses — has nothing here to start from.
 *
 * What is deliberately NOT the anchor: the footer. `Enter to ... · Esc to
 * cancel` is also what claude's first-run workspace-trust dialog prints, above
 * numbered options, and that dialog must keep parsing as `null` — pressing a
 * digit there picks "No, exit" and pressing Esc kills claude. Keying on the
 * footer would turn the most destructive screen claude draws into a card of
 * tappable buttons.
 *
 * Two options are refused rather than parsed, and both refusals are positive
 * detections rather than a failure to match:
 *
 *   - multiSelect and the multi-question stepper both draw a header chip row
 *     carrying `✔ Submit` and the `←`/`→` travel arrows. Their answer is not
 *     one keystroke; it is a sequence ending in Submit, and sending a digit
 *     there toggles a box instead of answering.
 *   - multiSelect additionally draws `[ ]` in front of every option label. That
 *     is the second line of defence, and the stepper is exactly why it cannot
 *     be the only one: its options are drawn identically to a single-select's.
 *
 * `Type something.` is dropped rather than offered: it opens a free-text field
 * the phone has no way to fill by pressing its digit.
 */

import { createHash } from "node:crypto";
import type { ParsedPrompt, PromptOption } from "./prompt-parse";

/** The last option every AskUserQuestion screen draws, below the mid rule. */
const ANCHOR_LABEL = /^Chat about this\.?$/;

/** A bare horizontal rule, the same shape the permission box uses. */
const RULE = /^\s*─{20,}\s*$/;

/** `❯ 1. A` / `  2. B` — the cursor caret is optional; claude has printed `›` too. */
const OPTION_LINE = /^\s*(?:[❯›>]\s*)?(\d+)\.\s+(\S.*?)\s*$/;

/** The escape hatch into a free-text field; a digit cannot answer it. */
const FREE_TEXT_LABEL = /^Type something\.?$/i;

/** The checkbox multiSelect draws in front of each label. */
const CHECKBOX_LABEL = /^\[[\sxX✔✓]?\]/;

/** The header chip's own leading glyph, not part of the question's title. */
const CHIP_GLYPH = /^[☐☑☒✔✓]\s*/;

/**
 * The chip row of a screen a digit can answer: claude's own progress glyph,
 * first thing on the line. A sequenced screen puts its travel arrows there
 * instead (`←  ☐ 第一題  ☐ 第二題  ✔ Submit  →`), and a region whose top rule
 * was clipped away starts with ordinary output — both fail this.
 *
 * Positive, because the negative form cannot be written safely: the rest of the
 * row is the model's own wording, so refusing on the word "submit" or on an
 * arrow anywhere in it also refuses "Submit PR?" and "v1 → v2" — real questions
 * that would then be Cancel-only AND still armed for the 90 s `esc`.
 */
const CHIP_ROW = /^[☐☑☒]/;

/** The submit affordance of a sequenced screen; no title writes a tick before it. */
const SEQUENCED_SUBMIT = /[✔✓]\s*submit/i;

/** How far above the anchor the box may start before this stops looking. */
const MAX_LOOKBACK = 40;

function fingerprintOf(parts: {
  toolLabel: string;
  argumentText: string;
  options: PromptOption[];
}): string {
  const material = [
    parts.toolLabel,
    parts.argumentText,
    ...parts.options.map((option) => `${option.id}. ${option.label}`),
  ].join(" ");
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16);
}

/**
 * claude's question screen, or `null` when this screen is not one — which
 * includes the variants whose answer is not a single digit.
 *
 * Never throws: a shape nobody anticipated must degrade to "unparseable" (the
 * caller then shows the raw tail with a Cancel action), never to an exception
 * in the event stream.
 */
export function parseClaudeQuestion(input: { text: string }): ParsedPrompt | null {
  const lines = input.text.split("\n");

  // Last anchor wins: the screen is scrollback, and an answered question may
  // still be visible above the live one.
  let anchorIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = OPTION_LINE.exec(lines[i] ?? "");
    if (match?.[2] && ANCHOR_LABEL.test(match[2])) {
      anchorIndex = i;
      break;
    }
  }
  if (anchorIndex === -1) return null;

  // ── region: upwards from the anchor, through the mid rule, to the box top ──
  const floor = Math.max(0, anchorIndex - MAX_LOOKBACK);
  let midRule = -1;
  for (let i = anchorIndex - 1; i >= floor; i -= 1) {
    if (RULE.test(lines[i] ?? "")) {
      midRule = i;
      break;
    }
  }
  if (midRule === -1) return null;

  let boxTop = -1;
  for (let i = midRule - 1; i >= floor; i -= 1) {
    if (RULE.test(lines[i] ?? "")) {
      boxTop = i;
      break;
    }
  }
  if (boxTop === -1) return null;

  // Kept untrimmed: the column an answer's number sits at is the only thing
  // separating the list from an option's own blurb, and trimming erases it.
  const region = lines.slice(boxTop + 1, midRule).filter((line) => line.trim().length > 0);

  const chip = region[0]?.trim();
  if (!chip) return null;
  // The chip row is checked alone rather than the whole region: a multiSelect
  // option list carries its own "Submit" continuation line, and letting that
  // fire this guard would leave the checkbox defence untested.
  if (!CHIP_ROW.test(chip)) return null;
  if (SEQUENCED_SUBMIT.test(chip)) return null;
  const toolLabel = chip.replace(CHIP_GLYPH, "").trim();

  // The answers line up; prose does not. Every captured screen puts each
  // answer's number at the same column whether or not that answer carries the
  // cursor, while a blurb sits further right and the question sits further
  // left — so the column the most numbered lines agree on is the answer list,
  // and a numbered line anywhere else is wording that merely looks like one.
  const body = region.slice(1);
  const numbered = body
    .map((line) => ({ line, match: OPTION_LINE.exec(line) }))
    .filter((entry): entry is { line: string; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({
      ...entry,
      column: entry.match.index + entry.match[0].indexOf(entry.match[1] ?? ""),
    }));

  const byColumn = new Map<number, number>();
  for (const entry of numbered) byColumn.set(entry.column, (byColumn.get(entry.column) ?? 0) + 1);
  let listColumn: number | null = null;
  let bestCount = 0;
  for (const [column, count] of byColumn) {
    // A tie goes to the leftmost column: an answer list is never indented past
    // its own blurbs, so the shallower run is the list.
    if (count > bestCount || (count === bestCount && listColumn !== null && column < listColumn)) {
      listColumn = column;
      bestCount = count;
    }
  }

  const questionLines: string[] = [];
  const options: PromptOption[] = [];
  // claude numbers its answers 1, 2, 3… with no gaps, so the next number is
  // always known. A gap means this column is not one answer list — question
  // wording that opens with `7.`, or output above a clipped box top carrying a
  // markdown numbered list — and a half-read list is the one outcome worth
  // refusing outright: its digits would be pressed against a live screen that
  // never offered them.
  let expected = 1;
  for (const line of body) {
    const match = OPTION_LINE.exec(line);
    const column = match ? match.index + match[0].indexOf(match[1] ?? "") : null;
    if (!match || column !== listColumn) {
      // Before the first answer this is the question; after it, an answer's own
      // one-line blurb, which the phone renders from the label instead.
      if (options.length === 0) questionLines.push(line.trim());
      continue;
    }
    const [, id, label] = match;
    if (!id || !label) continue;
    if (id !== String(expected)) return null;
    expected += 1;
    if (CHECKBOX_LABEL.test(label)) return null;
    if (FREE_TEXT_LABEL.test(label)) continue;
    options.push({ id, label, keystroke: id });
  }

  // Nothing tappable left. Showing a card with no options would be a dialog the
  // user can only cancel, which the raw-screen fallback already does better.
  if (options.length === 0) return null;

  const argumentText = questionLines.join("\n");

  return {
    dialect: "claude",
    promptKind: "question",
    toolLabel,
    argumentText,
    options,
    fingerprint: fingerprintOf({ toolLabel, argumentText, options }),
  };
}
