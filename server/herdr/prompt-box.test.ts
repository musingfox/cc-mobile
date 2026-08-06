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
import {
  composerHasTypedText,
  isHorizontalRule,
  ompComposerText,
  promptBoxBody,
} from "./prompt-box";

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

/**
 * omp's composer, captured live (spike 2026-08-06). Its typed text is drawn
 * INSIDE the bottom border of the status box, with no caret anywhere — so the
 * claude matcher above cannot see it however the region is located.
 */
describe("composerHasTypedText — omp", () => {
  function ompScreen(bottomBorderContent: string): string {
    return [
      "╭─── omp v17.2.9 ──────────────────────────────────────╮",
      "│      Welcome back!       │ Tips                      │",
      "╰──────────────────────────┴───────────────────────────╯",
      "",
      "──────────────────────────────────────────────────────────",
      " Update Available",
      " New version 17.2.10 is available. Run: omp update",
      "──────────────────────────────────────────────────────────",
      "",
      "╭──  Grok 4.5++ ·  high   ~/repo   main   4.7%/500K ──╮",
      `╰─ ${bottomBorderContent}                                 ─╯`,
    ].join("\n");
  }

  test("an empty omp composer is not typed-in", () => {
    expect(composerHasTypedText(ompScreen(""))).toBe(false);
  });

  test("a half-typed omp composer is typed-in", () => {
    expect(composerHasTypedText(ompScreen("half typed thing"))).toBe(true);
  });

  test("the Update Available banner is not mistaken for the composer", () => {
    // This is the pre-#33 failure exactly: the last two horizontal rules on an
    // omp screen fence that banner, which holds no caret, so the guard reported
    // "nothing typed" for every omp screen — and the phone would overwrite a
    // line the user was still writing.
    expect(promptBoxBody(ompScreen("half typed thing"))).toEqual([
      " Update Available",
      " New version 17.2.10 is available. Run: omp update",
    ]);
    expect(ompComposerText(ompScreen("half typed thing"))).toBe("half typed thing");
  });

  test("an omp screen with no status box at all reports nothing typed", () => {
    expect(ompComposerText("just some output\nand more")).toBeNull();
    expect(composerHasTypedText("just some output\nand more")).toBe(false);
  });
});
