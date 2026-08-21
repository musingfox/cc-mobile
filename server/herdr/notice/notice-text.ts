/**
 * notice-text.ts — bounded, redacted terminal text for a notice body.
 *
 * Screens that survive here become a fenced snippet the client can prefix
 * with "Error: ". Empty or whitespace-only screens stay silent. Credential
 * shapes are replaced before any trim so a later window cannot keep a token
 * fragment that redaction would have removed.
 */

const PLACEHOLDER = "[redacted]";
const LAST_LINES = 20;
/** Tail budget after the leading ellipsis; full clipped body is at most 2001. */
const MAX_CHARS = 2000;

/** JWT: three base64url segments, header typically starts with eyJ. */
const JWT =
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
/** Anthropic API keys. */
const SK_ANT = /\bsk-ant-[A-Za-z0-9-]+\b/g;
/** xAI API keys (`xai-` + hex-ish body). */
const XAI_KEY = /\bxai-[A-Za-z0-9]+\b/g;
/** Herd-style credential wrappers. */
const DOLLAR_CREDENTIAL = /\$\$CREDENTIAL_[^$\s]+\$\$/g;
/** A password labeled as such — the value, not the label. */
const PASSWORD_VALUE = /((?:password|passwd)\s*:\s*)\S+/gi;

/**
 * Replace credential-shaped substrings with a placeholder.
 * Shape allow-list only: prose that names a key, HTTP lines, and paths pass through.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(JWT, PLACEHOLDER)
    .replace(SK_ANT, PLACEHOLDER)
    .replace(XAI_KEY, PLACEHOLDER)
    .replace(DOLLAR_CREDENTIAL, PLACEHOLDER)
    .replace(PASSWORD_VALUE, `$1${PLACEHOLDER}`);
}

function wrappingFence(inner: string): string {
  let longest = 2;
  for (const line of inner.split("\n")) {
    if (line.length >= 3 && /^`+$/.test(line)) {
      longest = Math.max(longest, line.length);
    }
  }
  return "`".repeat(longest + 1);
}

function clipHead(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return `\u2026${text.slice(-MAX_CHARS)}`;
}

/**
 * Turn a raw screen into a notice body, or `null` when there is nothing to say.
 */
export function noticeTextFrom(screen: string): string | null {
  const redacted = redactSecrets(screen);
  if (redacted.trim() === "") return null;
  const inner = redacted.split("\n").slice(-LAST_LINES).join("\n").trim();
  const fence = wrappingFence(inner);
  return clipHead(`\n${fence}\n${inner}\n${fence}`);
}
