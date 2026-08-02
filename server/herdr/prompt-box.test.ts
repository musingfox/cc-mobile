/**
 * prompt-box — the composer-emptiness half of PromptInjectionReadinessGate.
 *
 * The probe captured `pane.read --source detection` while blocked and at the
 * trust dialog, but never on an idle pane, so the composer screens below are
 * built to the shape herdr's own `prompt_box_body` extractor defines (two
 * horizontal rules around the body). The blocked capture IS verbatim, and is
 * used to pin the case that matters most: a screen with no locatable box must
 * not be mistaken for a typed-in one.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composerHasTypedText, isHorizontalRule, promptBoxBody } from "./prompt-box";

const RULE = "─".repeat(60);
const BLOCKED_SCREEN = readFileSync(
  join(import.meta.dir, "permission", "fixtures", "blocked-bash-prompt.txt"),
  "utf8",
);

function screen(composer: string): string {
  return [
    "❯ an earlier prompt the user already submitted",
    "",
    "⏺ and the answer to it",
    "",
    RULE,
    composer,
    RULE,
    "  ⏵⏵ accept edits on · ⌘+t for todos",
  ].join("\n");
}

describe("prompt box location", () => {
  test("a run of box-drawing dashes is a rule; a bordered banner row is not", () => {
    expect(isHorizontalRule(RULE)).toBe(true);
    expect(isHorizontalRule("│ ──────────────── │")).toBe(false);
    expect(isHorizontalRule("╭─── Claude Code v2.1.220 ───╮")).toBe(false);
    expect(isHorizontalRule("")).toBe(false);
  });

  test("the body is what sits between the last two rules", () => {
    expect(promptBoxBody(screen(" ❯ hello"))).toEqual([" ❯ hello"]);
  });

  test("a screen with fewer than two rules has no locatable box", () => {
    expect(promptBoxBody("❯ nothing here\n")).toBeNull();
  });
});

describe("composerHasTypedText", () => {
  test("an empty caret is not typed-in", () => {
    expect(composerHasTypedText(screen(" ❯ "))).toBe(false);
  });

  test("a half-typed line is typed-in", () => {
    expect(composerHasTypedText(screen(" ❯ half typed"))).toBe(true);
  });

  test("the scrollback above the box is never mistaken for the composer", () => {
    // Every submitted turn is drawn with the same caret; a whole-screen search
    // would read a session's own history as half-typed input and refuse
    // everything forever.
    expect(composerHasTypedText(screen(" > "))).toBe(false);
  });

  test("a screen whose box cannot be located reports no typed text", () => {
    // Fail-open: absence of evidence that a human is typing is not evidence
    // that they are.
    expect(composerHasTypedText(BLOCKED_SCREEN)).toBe(false);
  });
});
