export const HERDR_PROBE_ENV_VARS = ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_SOCKET_PATH"] as const;

const CLAUDE_PROBE_ARGV = [
  "claude",
  "-p",
  "/help",
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
];

export interface ProbeSpec {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: string;
}

export function buildProbeSpec(input: {
  cwd: string;
  env: Record<string, string | undefined>;
}): ProbeSpec {
  const env = { ...input.env };
  for (const variable of HERDR_PROBE_ENV_VARS) delete env[variable];

  return { argv: [...CLAUDE_PROBE_ARGV], env, cwd: input.cwd };
}
