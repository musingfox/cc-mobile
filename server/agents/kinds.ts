/**
 * kinds.ts — LaunchableAgentKinds: which agents cc-mobile will start for you.
 *
 * This is the OUTBOUND vocabulary, and it is closed on purpose. #30's `agent`
 * field is the inbound one — herdr's own label, passed through verbatim as a
 * `z.string()` because its vocabulary grows between versions and an unknown
 * value there must survive. Here the value is handed to `agent.start`, which
 * turns it into an argv the daemon executes, so it is a closed `z.enum`: a
 * client must not be able to name what gets exec'd.
 *
 * Adding a kind is one entry here plus its argv below — and, if its replies
 * should be readable, a reader in transcript-readers.ts.
 */

/** Kinds `terminal_create` accepts. Everything else is refused by the Zod gate. */
export const LAUNCHABLE_AGENT_KINDS = ["claude", "omp"] as const;

export type LaunchableAgentKind = (typeof LAUNCHABLE_AGENT_KINDS)[number];

/** What a `terminal_create` without `agentKind` means (cached PWA bundles). */
export const DEFAULT_AGENT_KIND: LaunchableAgentKind = "claude";

/**
 * Whether this machine can actually run a kind — the binary is on PATH.
 *
 * ponytail: PATH only. herdr's integration status (the other half of the
 * question, and the one that decides whether `agent_status` is ever reported)
 * has no socket method — the daemon's method list at protocol 19 carries
 * `integration.install`/`uninstall` and no `status` — so answering it would
 * mean shelling out to the `herdr` binary, which ADR-015 makes the trunk's
 * business and not cc-mobile's. Installing the integration stays the one-time
 * setup step CLAUDE.md already documents. If a missing integration starts
 * showing up as "the session opens but never does anything", widen this to
 * read the integration state herdr writes under `~/.local/state/herdr/`.
 */
export function isAgentKindAvailable(kind: LaunchableAgentKind): boolean {
  // PATH passed explicitly: Bun.which's default is the PATH this process
  // started with, so a binary installed while the server runs would stay
  // invisible until a restart.
  return Bun.which(kind, { PATH: process.env.PATH ?? "" }) !== null;
}

/** The kinds this machine can launch, in declaration order. */
export function availableAgentKinds(): LaunchableAgentKind[] {
  return LAUNCHABLE_AGENT_KINDS.filter(isAgentKindAvailable);
}
