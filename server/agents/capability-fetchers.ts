/**
 * capability-fetchers.ts — CapabilityFetcherRegistry: which agent kinds
 * cc-mobile can list commands and agents for.
 *
 * The session list carries every pane herdr reports. Listing commands is not
 * that general: claude has a probe → enrich path (D4), and omp answers its own
 * RPC `get_available_commands` with names, descriptions and hints already
 * attached (server/capabilities/omp-probe.ts). A kind with no entry here is
 * answered by lookup miss — nothing is spawned and the disk is never touched on
 * its behalf.
 *
 * Deliberately one map and one lookup: no plugin mechanism, no lifecycle hooks,
 * no config file.
 */

import { type ProbeResult, probeClaudeCapabilities } from "../capabilities/claude-probe";
import { type EnrichedCapability, enrich, type PluginInfo } from "../capabilities/enrich";
import { type OmpProbeResult, probeOmpCapabilities } from "../capabilities/omp-probe";

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

/** omp's list needs no enrich step, and it has no agent definitions to offer. */
export function createOmpFetcher(
  probe: (cwd: string) => Promise<OmpProbeResult> = (cwd) => probeOmpCapabilities({ cwd }),
): CapabilityFetcher {
  return {
    async list({ cwd }) {
      const probed = await probe(cwd);
      if (!probed.ok) return { ok: false };
      return { ok: true, commands: probed.commands, agents: [] };
    },
  };
}

/**
 * kind → fetcher. Keyed `string | undefined` so an undetected kind misses by
 * lookup rather than by a special case at every call site.
 */
const FETCHERS = new Map<string | undefined, CapabilityFetcher>([
  ["claude", { list: listClaude }],
  ["omp", createOmpFetcher()],
]);

/** The fetcher for a kind, or `undefined` when that kind cannot list commands. */
export function capabilityFetcherFor(agent: string | undefined): CapabilityFetcher | undefined {
  return FETCHERS.get(agent);
}
