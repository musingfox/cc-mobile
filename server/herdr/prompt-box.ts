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
 *
 * Since #33 omp's composer is located too, by a different rule — see
 * `ompComposerText`. Before that this module silently failed open on every omp
 * screen: it located the "Update Available" banner as the box and found no
 * caret in it, so the phone would overwrite a half-typed line in the terminal
 * without noticing.
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
 * omp's composer: the bottom border of its status box, with whatever has been
 * typed drawn *inside the border line itself* (spike 2026-08-06):
 *
 *     ╭──   Grok 4.5++ ·  high   ~/repo   main   4.7%/500K ────────────╮
 *     ╰─ half typed thing                                              ─╯
 *
 * Two things follow, and both matter. There is no caret anywhere, so the claude
 * matcher above returns `false` however the region is located — which is why
 * this needed a matcher and not only a locator (#33). And the region is a
 * single line, not a body between rules: omp's only horizontal rules belong to
 * the transient "Update Available" banner, so `promptBoxBody` locates that
 * banner instead and reports a composer nobody is typing in.
 */
const OMP_COMPOSER_LINE = /^\s*╰─(.*?)─╯\s*$/;

/**
 * The text omp shows in its composer, or `null` when this screen has no omp
 * composer on it. Empty string means the composer is there and empty.
 */
export function ompComposerText(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = OMP_COMPOSER_LINE.exec(lines[i] ?? "");
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return null;
}

/**
 * True only when the composer positively shows typed text.
 *
 * Note this is asked ONLY of the box region: the same caret marks every
 * submitted turn in the scrollback above it (`❯ Run this exact bash command…`),
 * so a whole-screen search would read a session's own history as half-typed
 * input and refuse every prompt forever.
 *
 * Both terminals are checked on the same screen, and nothing says which agent
 * drew it. That is deliberate — the shapes cannot collide (claude has no
 * `╰─…─╯` composer, omp has no caret line inside a rule-bounded box), and the
 * caller is the send path, which would otherwise have to resolve a kind before
 * every prompt it injects.
 */
export function composerHasTypedText(text: string): boolean {
  const omp = ompComposerText(text);
  if (omp !== null) return omp.length > 0;

  const body = promptBoxBody(text);
  if (!body) return false;
  return body.some((line) => {
    const match = CARET_LINE.exec(line);
    return match !== null && match[1] !== undefined && match[1].trim().length > 0;
  });
}
