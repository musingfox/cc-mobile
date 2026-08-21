import { buildProbeSpec, type ProbeSpec } from "./probe-spec";

const DEFAULT_TIMEOUT_MS = 30_000;

export type ProbeSpawn = (spec: ProbeSpec) => {
  stdout: Promise<string>;
  kill(): void;
};

export type ProbePlugin = { name: string; path: string };

export type ProbeResult =
  | { ok: true; commands: string[]; agents: string[]; plugins: ProbePlugin[] }
  | { ok: false; reason: "timeout" | "no_init" | "spawn_error" };

function defaultSpawn(spec: ProbeSpec): { stdout: Promise<string>; kill(): void } {
  const proc = Bun.spawn(spec.argv, {
    cwd: spec.cwd,
    env: spec.env,
    stdout: "pipe",
    // Never "pipe": nothing here drains stderr, so a chatty child would fill
    // the OS pipe buffer and block until the 30s timeout killed it.
    stderr: "ignore",
  });
  return {
    stdout: new Response(proc.stdout).text(),
    kill: () => {
      proc.kill();
    },
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asPlugins(value: unknown): ProbePlugin[] {
  if (!Array.isArray(value)) return [];
  const plugins: ProbePlugin[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { name?: unknown }).name === "string" &&
      typeof (item as { path?: unknown }).path === "string"
    ) {
      plugins.push({
        name: (item as { name: string }).name,
        path: (item as { path: string }).path,
      });
    }
  }
  return plugins;
}

function parseInit(stdout: string): ProbeResult {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const msg = parsed as Record<string, unknown>;
    if (msg.subtype !== "init") continue;
    return {
      ok: true,
      commands: asStringArray(msg.slash_commands),
      agents: asStringArray(msg.agents),
      plugins: asPlugins(msg.plugins),
    };
  }
  return { ok: false, reason: "no_init" };
}

export async function probeClaudeCapabilities(input: {
  cwd: string;
  spawn?: ProbeSpawn;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawn = input.spawn ?? defaultSpawn;
  const spec = buildProbeSpec({ cwd: input.cwd, env: { ...process.env } });

  let child: { stdout: Promise<string>; kill(): void };
  try {
    child = spawn(spec);
  } catch {
    return { ok: false, reason: "spawn_error" };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      child.stdout.then((text) => ({ kind: "stdout" as const, text })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => {
          child.kill();
          resolve({ kind: "timeout" });
        }, timeoutMs);
      }),
    ]);
    if (raced.kind === "timeout") return { ok: false, reason: "timeout" };
    return parseInit(raced.text);
  } catch {
    return { ok: false, reason: "spawn_error" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
