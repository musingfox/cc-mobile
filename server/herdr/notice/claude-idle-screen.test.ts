/**
 * claude-idle-screen.test.ts — ClaudeAttentionScreenClassifier.
 *
 * A claude pane on the workspace-trust dialog is told apart from a pane that
 * is merely idle. Markers come from fixtures/trust-dialog.txt; screens that
 * were never captured do not get a pattern.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isClaudeAttentionScreen } from "./claude-idle-screen";

const FIXTURES = join(import.meta.dir, "../permission/fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("ClaudeAttentionScreenClassifier", () => {
  test("T1: the captured trust dialog is an attention screen", () => {
    expect(isClaudeAttentionScreen(fixture("trust-dialog.txt"))).toBe(true);
  });

  test("T2: the Quick safety check line alone is enough", () => {
    expect(
      isClaudeAttentionScreen(
        " Quick safety check: Is this a project you created or one you trust?",
      ),
    ).toBe(true);
  });

  test("T3: the Accessing workspace line alone is enough", () => {
    expect(isClaudeAttentionScreen(" Accessing workspace:\n\n /tmp/x\n")).toBe(true);
  });

  test("T4: an empty screen is not attention", () => {
    expect(isClaudeAttentionScreen("")).toBe(false);
  });

  test("T5: an ordinary idle composer is not attention", () => {
    expect(isClaudeAttentionScreen(fixture("claude-idle-composer.txt"))).toBe(false);
  });

  test("T6: omp Allow tool: bash is not attention", () => {
    expect(isClaudeAttentionScreen(fixture("omp-allow-tool-prompt.txt"))).toBe(false);
  });

  test("T7: a real claude permission prompt is not attention", () => {
    expect(isClaudeAttentionScreen(fixture("blocked-bash-prompt.txt"))).toBe(false);
  });
});
