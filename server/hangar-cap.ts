export const FALLBACK_HANGAR_CAP = 4;

export type HangarCapResolution = {
  cap: number;
  source: "override" | "perf-cores" | "unreadable";
  /** Set when `source` is "perf-cores". */
  cores?: number;
};

/**
 * A non-blank `env` pins the cap and must be a plain positive integer: a typo
 * throws rather than becoming a different cap than the operator wrote. Unset or
 * blank, the cap is performance cores minus two (floor one), or the fallback
 * when the count cannot be read.
 */
export function resolveHangarCapWithSource(
  env: string | undefined,
  readPerfCores: () => number | null,
): HangarCapResolution {
  const pinned = env?.trim();
  if (pinned) {
    if (!/^[1-9][0-9]*$/.test(pinned)) {
      throw new Error(`CC_MOBILE_HANGAR_CAP must be a positive integer, got "${env}"`);
    }
    return { cap: Number.parseInt(pinned, 10), source: "override" };
  }
  let n: number | null;
  try {
    n = readPerfCores();
  } catch {
    return { cap: FALLBACK_HANGAR_CAP, source: "unreadable" };
  }
  if (n === null || !Number.isInteger(n) || n < 1) {
    return { cap: FALLBACK_HANGAR_CAP, source: "unreadable" };
  }
  return { cap: Math.max(1, n - 2), source: "perf-cores", cores: n };
}

export function describeHangarCap({ cap, source, cores }: HangarCapResolution): string {
  const from =
    source === "override"
      ? "CC_MOBILE_HANGAR_CAP"
      : source === "perf-cores"
        ? `${cores} performance cores`
        : "performance cores unreadable";
  return `hangar cap ${cap} (${from})`;
}

type RunSysctl = (argv: string[]) => { exitCode: number; stdout: string };

const defaultRun: RunSysctl = (argv) => {
  const proc = Bun.spawnSync(argv, { stdout: "pipe", stderr: "ignore" });
  return { exitCode: proc.exitCode ?? 1, stdout: proc.stdout.toString() };
};

/**
 * Absolute path on purpose: pm2's PATH lacks /usr/sbin, and a bare `sysctl`
 * would fail there and silently land on the fallback cap.
 */
export function readPerfCoresViaSysctl(run: RunSysctl = defaultRun): number | null {
  try {
    const { exitCode, stdout } = run(["/usr/sbin/sysctl", "-n", "hw.perflevel0.physicalcpu"]);
    const text = stdout.trim();
    if (exitCode !== 0 || !/^[1-9][0-9]*$/.test(text)) return null;
    return Number.parseInt(text, 10);
  } catch {
    return null;
  }
}
