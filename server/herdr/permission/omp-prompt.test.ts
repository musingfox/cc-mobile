/**
 * OmpPromptParse — omp's permission prompt, and the keys that answer it.
 *
 * Every screen below is a live capture (spike 2026-08-06, omp 17.2.9 under
 * `--approval-mode always-ask`), including the exact cursor glyph: U+F054, a
 * Nerd Font chevron, which is what actually sits in front of the selected row.
 */

import { describe, expect, test } from "bun:test";
import { ompAnswerKeys, parseOmpPrompt } from "./omp-prompt";
import { parseBlockedPrompt } from "./prompt-parse";

/** The cursor omp draws, verbatim from the capture's bytes (ef 81 94). */
const CURSOR = "\uF054";

/** A real blocked screen, trimmed to the region the parser walks. */
const OMP_PROMPT = [
  " ⠧ Run both echo commands ⟨esc⟩",
  "",
  "──────────────────────────────────────────────────────────────────────────",
  "",
  " Allow tool: bash",
  " Command: echo PERM-SPIKE-1 && echo PERM-SPIKE-2",
  "",
  ` ${CURSOR} Approve`,
  "   Deny",
  "",
  " up/down navigate  enter select  esc cancel",
  "",
  "──────────────────────────────────────────────────────────────────────────",
].join("\n");

/** The same prompt after one Down — the cursor moved, the question did not. */
const OMP_PROMPT_ON_DENY = OMP_PROMPT.replace(` ${CURSOR} Approve`, "   Approve").replace(
  "   Deny",
  ` ${CURSOR} Deny`,
);

/**
 * omp reports `blocked` for API failures too — a 429 with retries exhausted
 * looks identical to `agent_status`. This is what that screen carries.
 */
const OMP_API_ERROR = [
  " ⠧ Working ⟨esc⟩",
  "",
  "──────────────────────────────────────────────────────────────────────────",
  "",
  " Error: xai returned 429 Too Many Requests",
  " Retries exhausted after 5 attempts.",
  "",
  "──────────────────────────────────────────────────────────────────────────",
  "",
  "╭──  Grok 4.5++ ·  high   ~/repo   main ──────────────────────────────────╮",
  "╰─                                                                       ─╯",
].join("\n");

describe("OmpPromptParse", () => {
  test("reads the tool, the arguments and both options off a real prompt", () => {
    const parsed = parseOmpPrompt({ text: OMP_PROMPT });

    expect(parsed).not.toBeNull();
    expect(parsed?.dialect).toBe("omp");
    expect(parsed?.toolLabel).toBe("bash");
    expect(parsed?.argumentText).toBe("Command: echo PERM-SPIKE-1 && echo PERM-SPIKE-2");
    // Two, not the bundle's four-way constant set: what the terminal draws is
    // what the phone is offered.
    expect(parsed?.options).toEqual([
      { id: "0", label: "Approve" },
      { id: "1", label: "Deny" },
    ]);
    expect(parsed?.selectedIndex).toBe(0);
  });

  test("tracks where the terminal's own cursor is", () => {
    expect(parseOmpPrompt({ text: OMP_PROMPT_ON_DENY })?.selectedIndex).toBe(1);
  });

  test("the cursor moving does not make it a different question", () => {
    // Otherwise a human at the keyboard scrolling the list would invalidate the
    // answer the phone is about to send.
    expect(parseOmpPrompt({ text: OMP_PROMPT })?.fingerprint).toBe(
      parseOmpPrompt({ text: OMP_PROMPT_ON_DENY })?.fingerprint,
    );
  });

  test("a blocked screen that is an API error is not a permission prompt", () => {
    // The whole point of keying on `Allow tool: `: without it every exhausted
    // retry would raise a permission card on the phone that answers nothing.
    expect(parseOmpPrompt({ text: OMP_API_ERROR })).toBeNull();
  });

  test("a marker with no option list parses as nothing rather than half a prompt", () => {
    // Caught mid-draw. Answering would be pressing Enter on an unread selection.
    const halfDrawn = [" Allow tool: bash", " Command: echo hi", ""].join("\n");
    expect(parseOmpPrompt({ text: halfDrawn })).toBeNull();
  });

  test("the last prompt on screen wins over an answered one in scrollback", () => {
    const twice = [
      OMP_PROMPT.replace("bash", "read").replace(/echo PERM-SPIKE-1 && echo PERM-SPIKE-2/, "a.ts"),
      OMP_PROMPT,
    ].join("\n");

    expect(parseOmpPrompt({ text: twice })?.toolLabel).toBe("bash");
  });

  test("never throws on a shape nobody anticipated", () => {
    for (const text of ["", "\n\n", " Allow tool: ", "Allow tool:\n\n\n"]) {
      expect(() => parseOmpPrompt({ text })).not.toThrow();
    }
  });
});

describe("OmpPromptParse — reached through the shared entry point", () => {
  test("parseBlockedPrompt falls through to omp when claude's marker is absent", () => {
    const parsed = parseBlockedPrompt({ text: OMP_PROMPT });

    expect(parsed?.dialect).toBe("omp");
    expect(parsed?.toolLabel).toBe("bash");
  });

  test("a claude prompt still parses as claude", () => {
    const claudePrompt = [
      "────────────────────────────────────────────",
      "Bash command",
      "whoami",
      "Show the current user",
      "Do you want to proceed?",
      "❯ 1. Yes",
      "  2. No",
      "────────────────────────────────────────────",
    ].join("\n");

    const parsed = parseBlockedPrompt({ text: claudePrompt });

    expect(parsed?.dialect).toBe("claude");
    // claude's options keep their single keystroke — the printed digit.
    expect(parsed?.options[0]).toEqual({ id: "1", label: "Yes", keystroke: "1" });
  });
});

describe("OmpAnswerKeys", () => {
  test("travels the distance from where the cursor is, then selects", () => {
    expect(ompAnswerKeys(1, 0)).toEqual(["Down", "Enter"]);
    expect(ompAnswerKeys(3, 0)).toEqual(["Down", "Down", "Down", "Enter"]);
  });

  test("goes up when the target is above the cursor", () => {
    // The list does not wrap (live: Down at the last entry stays put), so the
    // negative direction genuinely needs Up rather than more Downs.
    expect(ompAnswerKeys(0, 1)).toEqual(["Up", "Enter"]);
    expect(ompAnswerKeys(0, 3)).toEqual(["Up", "Up", "Up", "Enter"]);
  });

  test("already on the target presses only Enter", () => {
    expect(ompAnswerKeys(1, 1)).toEqual(["Enter"]);
  });

  test("an unread cursor position yields no keys at all", () => {
    // Enter would then choose whatever the cursor sits on — on an
    // Approve/Deny prompt, a coin flip between allowing and refusing a tool.
    expect(ompAnswerKeys(0, undefined)).toBeUndefined();
  });
});
