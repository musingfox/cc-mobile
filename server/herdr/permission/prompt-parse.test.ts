/**
 * BlockedPromptParse — the permission prompt on screen becomes structured data.
 *
 * Both fixtures are verbatim `pane.read` captures from the live probe
 * (2026-08-02): `blocked-bash-prompt.txt` is the tail of a pane herdr reported
 * as `blocked`, `trust-dialog.txt` is claude's first-run folder-trust dialog —
 * which herdr reports as `idle` and where a keystroke means something else
 * entirely.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlockedPrompt } from "./prompt-parse";

const FIXTURES = join(import.meta.dir, "fixtures");
const bashPrompt = readFileSync(join(FIXTURES, "blocked-bash-prompt.txt"), "utf8");
const trustDialog = readFileSync(join(FIXTURES, "trust-dialog.txt"), "utf8");

describe("BlockedPromptParse", () => {
  test("parses the live Bash prompt into label, argument, description and 3 options", () => {
    const parsed = parseBlockedPrompt({ text: bashPrompt });

    expect(parsed).not.toBeNull();
    expect(parsed?.toolLabel).toBe("Bash command");
    expect(parsed?.argumentText).toBe("touch /private/tmp/cf-0802-JmBO/probe/cwd/canary2.txt");
    expect(parsed?.description).toBe("Create empty canary2.txt file");
    expect(parsed?.options).toEqual([
      { id: "1", label: "Yes", keystroke: "1" },
      {
        id: "2",
        label: "Yes, and always allow access to cwd/ from this project",
        keystroke: "2",
      },
      { id: "3", label: "No", keystroke: "3" },
    ]);
  });

  test("a two-option prompt yields two options, not a padded three", () => {
    const twoOptions = bashPrompt
      .replace(" ❯ 1. Yes\n   2. Yes, and always allow access to cwd/ from this project\n", "")
      .replace("   3. No", " ❯ 1. Yes\n   2. No");

    const parsed = parseBlockedPrompt({ text: twoOptions });

    expect(parsed?.options.map((option) => option.label)).toEqual(["Yes", "No"]);
  });

  test("a screen with no proceed marker is not a permission prompt", () => {
    const parsed = parseBlockedPrompt({ text: "❯ ready\n\n  nothing pending here\n" });

    expect(parsed).toBeNull();
  });

  test("the first-run trust dialog parses as null, never as a prompt", () => {
    // It draws a rule and numbered options exactly like a permission prompt.
    // Answering it is destructive: option 2 is "No, exit" and `esc` kills claude.
    expect(trustDialog).toContain("1. Yes, I trust this folder");
    expect(parseBlockedPrompt({ text: trustDialog })).toBeNull();
  });

  test("the same prompt fingerprints identically; a different argument does not", () => {
    const first = parseBlockedPrompt({ text: bashPrompt });
    const again = parseBlockedPrompt({ text: bashPrompt });
    const other = parseBlockedPrompt({
      text: bashPrompt
        .replace("canary2.txt file", "canary9.txt file")
        .replace("cwd/canary2.txt\n", "cwd/canary9.txt\n"),
    });

    expect(first?.fingerprint).toBe(again?.fingerprint as string);
    expect(other?.fingerprint).not.toBe(first?.fingerprint as string);
  });

  test("a live spinner above the prompt does not change the fingerprint", () => {
    // The surrounding screen ticks ("Brewed for 18s") while the same question
    // stays up; fingerprinting the raw body would make every answer look stale.
    const later = bashPrompt.replace("Cooked for 17s", "Cooked for 41s");

    expect(parseBlockedPrompt({ text: later })?.fingerprint).toBe(
      parseBlockedPrompt({ text: bashPrompt })?.fingerprint as string,
    );
  });

  test("a prompt whose option lines are unreadable still parses, with no options", () => {
    const noOptions = bashPrompt.replace(/^\s*(?:❯\s*)?\d+\..*$/gm, "   ???");

    const parsed = parseBlockedPrompt({ text: noOptions });

    expect(parsed).not.toBeNull();
    expect(parsed?.options).toEqual([]);
  });
});
