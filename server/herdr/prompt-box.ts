/**
 * prompt-box.ts — is there half-typed text in the terminal's composer?
 *
 * Part of PromptInjectionReadinessGate (Decision M10). Under #29 the phone can
 * drive a session the user opened in their own terminal, so "inject a prompt"
 * now means "type into a composer a human may be standing in front of". Sending
 * `pane.send_text` on top of a half-written line silently corrupts it into one
 * interleaved prompt neither party wrote.
 *
 * The region is located exactly the way herdr locates it for its own
 * `live_prompt_box` detection rule (`src/detect/manifest.rs::prompt_box_body`,
 * `claude.toml` lines 63-77): the composer body is what sits between the last
 * two horizontal rules on screen. Reusing herdr's notion of the prompt box —
 * rather than inventing a second one — is what keeps this agreeing with the
 * `agent_status` the same daemon reports.
 *
 * Deliberately fail-open: a screen whose prompt box cannot be located is
 * reported as NOT typed-in. Absence of evidence that a human is typing is not
 * evidence that they are, and the alternative — refusing every prompt whose
 * screen we cannot parse — would make the whole feature unusable the first time
 * claude changes its box drawing.
 */

/**
 * herdr's rule, ported: a line of `─` characters, either alone or with at least
 * three of them before other content. Box-drawing rows (`╭───╮`, `│ … │`) are
 * not rules, which is what keeps claude's welcome banner out of the search.
 */
export function isHorizontalRule(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  let ruleChars = 0;
  while (ruleChars < trimmed.length && trimmed[ruleChars] === "─") ruleChars += 1;
  if (ruleChars === 0) return false;
  const suffix = trimmed.slice(ruleChars).trimStart();
  return suffix.length === 0 || ruleChars >= 3;
}

/**
 * The composer body, or `null` when the screen has no locatable prompt box
 * (fewer than two horizontal rules — e.g. while a permission prompt has taken
 * the screen over).
 */
export function promptBoxBody(text: string): string[] | null {
  const lines = text.split("\n");

  // Scan up from the bottom; the second rule found is the box's top border.
  let seen = 0;
  let top = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isHorizontalRule(lines[i] ?? "")) continue;
    seen += 1;
    if (seen === 2) {
      top = i;
      break;
    }
  }
  if (top === -1) return null;

  let end = lines.length;
  for (let i = top + 1; i < lines.length; i += 1) {
    if (isHorizontalRule(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return lines.slice(top + 1, end);
}

/** `❯ something` / `> something` — the caret plus whatever has been typed after it. */
const CARET_LINE = /^\s*[❯>]\s?(.*)$/;

/**
 * True only when the composer positively shows typed text.
 *
 * Note this is asked ONLY of the box region: the same caret marks every
 * submitted turn in the scrollback above it (`❯ Run this exact bash command…`),
 * so a whole-screen search would read a session's own history as half-typed
 * input and refuse every prompt forever.
 */
export function composerHasTypedText(text: string): boolean {
  const body = promptBoxBody(text);
  if (!body) return false;
  return body.some((line) => {
    const match = CARET_LINE.exec(line);
    return match !== null && match[1] !== undefined && match[1].trim().length > 0;
  });
}
