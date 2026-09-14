/**
 * omp-prompt.ts — the omp permission prompt, parsed off the same screen read.
 *
 * A separate file from prompt-parse.ts because these are two different
 * terminals' languages, not two cases of one. Everything differs: the marker,
 * how the region is bounded, how options are drawn, and — the part that reaches
 * furthest — how one is chosen. claude prints numbered options and takes the
 * digit; omp prints an unnumbered list with a cursor glyph and takes arrow keys
 * plus Enter, which means the answer depends on where the cursor is *now*, not
 * only on which option was picked.
 *
 * Captured live (spike 2026-08-06, omp 17.2.9, `--approval-mode always-ask`),
 * `pane.read --source detection` and `--source visible` byte-identical:
 *
 *     ────────────────────────────────────────────
 *
 *      Allow tool: bash
 *      Command: echo PERM-SPIKE-1 && echo PERM-SPIKE-2
 *
 *       Approve            ← U+F054, a Nerd Font chevron
 *        Deny
 *
 *      up/down navigate  enter select  esc cancel
 *
 *     ────────────────────────────────────────────
 *
 * omp 17.4.1 (capture 2026-08-25) draws the same prompt inside a panel, and
 * the rewrite it forced is the reason `stripBorder` exists:
 *
 *     \u256d\u2500 Allow tool: bash \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e
 *     \u2502                                    \u2502
 *     \u2502 Command: touch /tmp/\u2026/canary.txt    \u2502
 *     \u2502                                    \u2502
 *     \u2502   Approve                          \u2502   <- \u2502, two spaces, then U+F054
 *     \u2502    Deny                            \u2502
 *     \u2502                                    \u2502
 *     \u2502 up/down navigate  enter select     \u2502
 *     \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f
 *
 * The words did not change; their frame did. The marker moved into the title
 * rule, the footer and every option gained a `\u2502`, and a blank padding row
 * appeared between the marker and the arguments. All three parse anchors missed
 * at once, and nothing failed loudly: the pane sat blocked and the phone was
 * never asked. Only a live capture shows this \u2014 the unit fixtures were pinned
 * to 17.2.9 and stayed green throughout.
 *
 * ponytail: parsing another program's screen rots by design. Expect the next
 * omp release to move something again; the live e2e is the only check that sees
 * it.
 *
 * Two things the ticket predicted turned out otherwise, and this file follows
 * the capture rather than the prediction:
 *
 *   - The option set is NOT the bundle's four-way `allow_once` / `allow_always`
 *     / `reject_once` / `reject_always`. A bash prompt draws two, Approve and
 *     Deny. So options are parsed, exactly as claude's are — never synthesised
 *     from a constant, and never rejected for failing to number four.
 *   - The prompt IS fenced by horizontal rules, the same shape claude uses. The
 *     rules are not the marker though: an omp screen carries other rules (the
 *     "Update Available" banner), so `Allow tool: ` is what identifies a prompt.
 *
 * That marker doubles as the classifier the ticket asks for: omp's extension
 * reports `blocked` for API failures too (a 429 with retries exhausted looks
 * exactly like a pending permission to `agent_status`), and a blocked screen
 * without this marker is a state, not a question. Returning `null` there is
 * what keeps a failed API call from raising a permission card on the phone.
 */

import { createHash } from "node:crypto";
import type { ParsedPrompt, PromptOption } from "./prompt-parse";

/**
 * The box omp draws around the prompt, removed before anything else is read.
 *
 * 17.2.9 printed the prompt as bare lines between two horizontal rules; 17.4.1
 * puts it in a panel, which moved the marker into the box's title rule and put
 * `\u2502` in front of every option and the footer. Stripping the decoration at
 * both ends is what lets one set of anchors read both shapes: a flat line has
 * nothing to strip but its own indentation, which they trimmed anyway.
 *
 * ponytail: the whole Box Drawing block, from either end, greedily. A tool
 * argument that itself ends in `\u2500` loses that character from the text shown
 * on the phone. Narrow it if a real prompt ever gets clipped — the keystroke
 * path never reads these bytes, so the blast radius is display only.
 */
const BORDER = /^[\s\u2500-\u257F]+|[\s\u2500-\u257F]+$/gu;

function stripBorder(line: string): string {
  return line.replace(BORDER, "");
}

/** The marker every omp permission prompt carries, and the tool it names. */
const ALLOW_TOOL = /^\s*Allow tool:\s*(\S.*?)\s*$/;

/**
 * The footer omp draws under the options. It bounds the option list, and its
 * presence is the second piece of evidence that this really is omp's prompt.
 */
const NAV_HINT = /^\s*up\/down\s+navigate\b/i;

/**
 * The selection cursor. Matched as a range rather than as one character: it is
 * U+F054 today, but every glyph in a Nerd Font icon set lives in the private
 * use area, so a theme or version that draws a different arrow still parses.
 * `❯` and `>` are included so a plain-ASCII fallback is not a parse failure.
 */
const CURSOR = /^[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}❯>]\s*/u;

/** How far above the marker the argument lines may start. */
const MAX_HEADER_LOOKBACK = 12;

function fingerprintOf(parts: {
  toolLabel: string;
  argumentText: string;
  options: PromptOption[];
}): string {
  // Deliberately excludes the cursor position: a human at the terminal moving
  // the selection does not make it a different question, and fingerprinting it
  // would make every phone answer arrive stale.
  const material = [parts.toolLabel, parts.argumentText, ...parts.options.map((o) => o.label)].join(
    " ",
  );
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16);
}

/**
 * omp's prompt, or `null` when this screen is not one — which includes every
 * other reason omp reports `blocked`.
 *
 * Never throws: an unanticipated shape must degrade to "unparseable", never to
 * an exception in the event stream.
 */
export function parseOmpPrompt(input: { text: string }): ParsedPrompt | null {
  const lines = input.text.split("\n").map(stripBorder);

  // Last marker wins: an answered prompt may still be visible in scrollback.
  let markerIndex = -1;
  let toolLabel = "";
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = ALLOW_TOOL.exec(lines[i] ?? "");
    if (match?.[1]) {
      markerIndex = i;
      toolLabel = match[1];
      break;
    }
  }
  if (markerIndex === -1) return null;

  // ── header: the marker's own lines, down to the blank line before the list ─
  const header: string[] = [];
  const headerCeiling = Math.min(lines.length, markerIndex + 1 + MAX_HEADER_LOOKBACK);
  let cursor = markerIndex + 1;
  // The panel pads a blank row under its title rule; the flat shape put the
  // arguments straight after the marker. Skipping leading blanks reads both,
  // and costs nothing on a screen that has none.
  while (cursor < headerCeiling && (lines[cursor] ?? "").length === 0) cursor += 1;
  for (; cursor < headerCeiling; cursor += 1) {
    const line = lines[cursor] ?? "";
    if (line.length === 0) break;
    header.push(line);
  }
  const argumentText = header.join("\n");

  // ── options: everything between the header and the navigation footer ───────
  const options: PromptOption[] = [];
  let selectedIndex: number | undefined;
  let sawNavHint = false;
  for (let i = cursor; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (NAV_HINT.test(raw)) {
      sawNavHint = true;
      break;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    const selected = CURSOR.test(trimmed);
    const label = trimmed.replace(CURSOR, "").trim();
    if (label.length === 0) continue;
    if (selected) selectedIndex = options.length;
    // The id is the position, because omp gives its options no identity of
    // their own: no number is printed, and the answer is a distance to travel.
    options.push({ id: String(options.length), label });
  }

  // Both halves or nothing. A screen carrying the marker but no option list is
  // a prompt caught mid-draw (or a shape this parser does not know), and
  // answering it would be pressing Enter on an unknown selection.
  if (!sawNavHint || options.length === 0) return null;

  return {
    dialect: "omp",
    promptKind: "permission",
    toolLabel,
    argumentText,
    options,
    ...(selectedIndex !== undefined ? { selectedIndex } : {}),
    fingerprint: fingerprintOf({ toolLabel, argumentText, options }),
  };
}

/**
 * The keys that move the selection to `targetIndex` and choose it.
 *
 * A delta, not a count from zero: on a pane the user is sitting at, the cursor
 * may already have been moved. Live behaviour (spike 2026-08-06): the list does
 * NOT wrap — pressing Down at the last entry leaves it there — so overshooting
 * is harmless but under-shooting is not, and the negative direction genuinely
 * needs `Up`.
 *
 * An unknown current position yields `undefined` rather than a guess: pressing
 * Enter on a selection nobody read could approve a tool call the user denied.
 */
export function ompAnswerKeys(
  targetIndex: number,
  selectedIndex: number | undefined,
): string[] | undefined {
  if (selectedIndex === undefined || targetIndex < 0) return undefined;
  const delta = targetIndex - selectedIndex;
  const key = delta < 0 ? "Up" : "Down";
  return [...Array(Math.abs(delta)).fill(key), "Enter"];
}
