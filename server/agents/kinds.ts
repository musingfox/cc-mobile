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
 * The PATH half of availability: the binary is there to exec. The other half,
 * whether herdr's integration for the kind is installed, is a daemon RPC and
 * is joined in `resolveAgentAvailability` (ADR-015 §2026-10-03).
 */
export function isAgentKindAvailable(kind: LaunchableAgentKind): boolean {
  // PATH passed explicitly: Bun.which's default is the PATH this process
  // started with, so a binary installed while the server runs would stay
  // invisible until a restart.
  return Bun.which(kind, { PATH: process.env.PATH ?? "" }) !== null;
}

/** The kinds whose binary is on PATH, in declaration order. */
export function availableAgentKinds(): LaunchableAgentKind[] {
  return LAUNCHABLE_AGENT_KINDS.filter(isAgentKindAvailable);
}

/** How an available kind's herdr integration is reported on the wire. */
export const AGENT_INTEGRATION_STATES = ["current", "outdated"] as const;

export type AgentIntegrationState = (typeof AGENT_INTEGRATION_STATES)[number];

export interface AgentAvailability {
  kinds: LaunchableAgentKind[];
  /**
   * The integration state of every kind in `kinds`; `null` when herdr could
   * not be asked, and `kinds` is then the PATH answer alone.
   */
  integrations: Partial<Record<LaunchableAgentKind, AgentIntegrationState>> | null;
}

/**
 * Availability = on PATH ∧ herdr's integration for the kind is not
 * `not_installed`. `integrationStates` is `integration.list` keyed by target —
 * herdr's target names are the kind names — or `null` when that call failed.
 *
 * A kind herdr does not list counts as not installed: with no integration at
 * all herdr can never report the pane's `agent_status`, which is exactly the
 * silent failure this check exists to prevent. A state value herdr has not
 * used before counts as installed, per the `!== "not_installed"` contract, and
 * travels as `current` because the wire has no word for it.
 */
export function resolveAgentAvailability(
  integrationStates: Readonly<Record<string, string>> | null,
): AgentAvailability {
  const onPath = availableAgentKinds();
  if (integrationStates === null) return { kinds: onPath, integrations: null };

  const kinds: LaunchableAgentKind[] = [];
  const integrations: Partial<Record<LaunchableAgentKind, AgentIntegrationState>> = {};
  for (const kind of onPath) {
    const state = integrationStates[kind];
    if (state === undefined || state === "not_installed") continue;
    kinds.push(kind);
    integrations[kind] = state === "outdated" ? "outdated" : "current";
  }
  return { kinds, integrations };
}
