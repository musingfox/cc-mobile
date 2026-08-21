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
/** GitHub tokens: personal access, oauth, user, server, refresh. */
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g;
/** OpenAI-style keys, including the `sk-proj-` project form. */
const SK_KEY = /\bsk-[A-Za-z0-9_-]{20,}\b/g;
/** Slack tokens: bot, user, app, workspace, refresh. */
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g;
/** AWS access key ids — the fixed `AKIA` prefix plus 16 uppercase chars. */
const AWS_ACCESS_KEY = /\bAKIA[A-Z0-9]{16}\b/g;
/** A password labeled as such — the value, not the label. */
const PASSWORD_VALUE = /((?:password|passwd)\s*[:=]\s*)\S+/gi;

/*
 * Deliberately absent: bare 64-char hex and JWTs whose header does not start
 * with `eyJ`. Both are pure length/charset shapes with no distinguishing
 * prefix, so they match far more than credentials — a 64-char hex string is
 * just as likely a commit sha or a checksum, and redacting it would turn the
 * error message this feature exists to surface into something unreadable.
 * Over-redaction is a functional failure here, not a safe default (D4: keep
 * this a small, auditable allow-list of high-precision shapes).
 */

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
    .replace(GITHUB_TOKEN, PLACEHOLDER)
    .replace(SK_KEY, PLACEHOLDER)
    .replace(SLACK_TOKEN, PLACEHOLDER)
    .replace(AWS_ACCESS_KEY, PLACEHOLDER)
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
