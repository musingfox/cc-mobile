/**
 * capability-fetchers.ts — CapabilityFetcherRegistry: which agent kinds
 * cc-mobile can list commands and agents for.
 *
 * The session list carries every pane herdr reports. Listing commands is not
 * that general: only claude has a probe → enrich path in this flow (D4). A kind
 * with no entry here is answered by lookup miss — nothing is spawned and the
 * disk is never touched on its behalf.
 *
 * Deliberately one map and one lookup: no plugin mechanism, no lifecycle hooks,
 * no config file. ACP / omp is not registered.
 */

import { probeClaudeCapabilities, type ProbeResult } from "../capabilities/claude-probe";
import { enrich, type EnrichedCapability, type PluginInfo } from "../capabilities/enrich";

export type CommandInfo = EnrichedCapability;
export type AgentInfo = EnrichedCapability;

export type CapabilityListResult =
  | { ok: true; commands: CommandInfo[]; agents: AgentInfo[] }
  | { ok: false };

export type CapabilityProbe = (cwd: string) => Promise<ProbeResult>;

export type CapabilityEnrich = (
  names: string[],
  options?: { plugins?: PluginInfo[] },
) => EnrichedCapability[];

/** One kind's answer to "what commands and agents does this directory list". */
export interface CapabilityFetcher {
  list(input: {
    cwd: string;
    probe?: CapabilityProbe;
    enrich?: CapabilityEnrich;
  }): Promise<CapabilityListResult>;
}

async function listClaude(input: {
  cwd: string;
  probe?: CapabilityProbe;
  enrich?: CapabilityEnrich;
}): Promise<CapabilityListResult> {
  const probe = input.probe ?? ((cwd) => probeClaudeCapabilities({ cwd }));
  const join = input.enrich ?? ((names, options) => enrich(names, options));
  const probed = await probe(input.cwd);
  if (!probed.ok) return { ok: false };
  const options = { plugins: probed.plugins };
  return {
    ok: true,
    commands: join(probed.commands, options),
    agents: join(probed.agents, options),
  };
}

/**
 * kind → fetcher. Keyed `string | undefined` so an undetected kind misses by
 * lookup rather than by a special case at every call site.
 */
const FETCHERS = new Map<string | undefined, CapabilityFetcher>([
  ["claude", { list: listClaude }],
]);

/** The fetcher for a kind, or `undefined` when that kind cannot list commands. */
export function capabilityFetcherFor(agent: string | undefined): CapabilityFetcher | undefined {
  return FETCHERS.get(agent);
}
