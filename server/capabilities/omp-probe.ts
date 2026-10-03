/**
 * omp-probe.ts — what commands omp offers in a directory, asked of omp itself.
 *
 * omp's RPC mode answers `get_available_commands` before any model call, so
 * the probe needs no provider credentials. Measured 2026-10-03 on omp 18.4.3:
 * 81 commands with name, description and argument hint; with `--no-session` no
 * session file is written. Each run does leave omp's own process log and a
 * daemon client record under ~/.omp — operational traces, not a conversation.
 *
 * omp's RPC lists no agent definitions, so the agent half is always empty.
 */

import type { EnrichedCapability } from "./enrich";

const DEFAULT_TIMEOUT_MS = 30_000;
const REQUEST_ID = "cc-mobile-capabilities";

export const OMP_PROBE_ARGV = ["omp", "--mode", "rpc", "--no-session", "--no-title"] as const;

export type OmpProbeResult =
  | { ok: true; commands: EnrichedCapability[] }
  | { ok: false; reason: "timeout" | "no_response" | "spawn_error" };

/** One running probe: lines from its stdout, a way to ask, and a way to stop it. */
export interface OmpProbeProcess {
  lines: AsyncIterable<string>;
  send(line: string): void;
  kill(): void;
}

export type OmpProbeSpawn = (input: { argv: readonly string[]; cwd: string }) => OmpProbeProcess;

async function* splitLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let index = buffered.indexOf("\n");
    while (index !== -1) {
      yield buffered.slice(0, index);
      buffered = buffered.slice(index + 1);
      index = buffered.indexOf("\n");
    }
  }
  if (buffered) yield buffered;
}

function defaultSpawn(input: { argv: readonly string[]; cwd: string }): OmpProbeProcess {
  const proc = Bun.spawn([...input.argv], {
    cwd: input.cwd,
    stdin: "pipe",
    stdout: "pipe",
    // Never "pipe": nothing drains stderr, and a full pipe would stall omp.
    stderr: "ignore",
  });
  return {
    lines: splitLines(proc.stdout),
    send: (line) => {
      proc.stdin.write(line);
      proc.stdin.flush();
    },
    kill: () => proc.kill(),
  };
}

function asCommand(value: unknown): EnrichedCapability | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { name?: unknown; description?: unknown; input?: unknown };
  if (typeof raw.name !== "string" || !raw.name) return null;
  const command: EnrichedCapability = { name: raw.name };
  if (typeof raw.description === "string" && raw.description) {
    command.description = raw.description;
  }
  const hint = (raw.input as { hint?: unknown } | undefined)?.hint;
  if (typeof hint === "string" && hint) command.argumentHint = hint;
  return command;
}

/** The commands in omp's answer to our request, or null when the line is not that answer. */
export function parseOmpCommandsResponse(line: string): EnrichedCapability[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const msg = parsed as Record<string, unknown>;
  if (msg.type !== "response" || msg.id !== REQUEST_ID || msg.success !== true) return null;
  const commands = (msg.data as { commands?: unknown } | undefined)?.commands;
  if (!Array.isArray(commands)) return null;
  return commands.map(asCommand).filter((c): c is EnrichedCapability => c !== null);
}

export async function probeOmpCapabilities(input: {
  cwd: string;
  spawn?: OmpProbeSpawn;
  timeoutMs?: number;
}): Promise<OmpProbeResult> {
  const spawn = input.spawn ?? defaultSpawn;
  let child: OmpProbeProcess;
  try {
    child = spawn({ argv: OMP_PROBE_ARGV, cwd: input.cwd });
  } catch {
    return { ok: false, reason: "spawn_error" };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = (async (): Promise<OmpProbeResult> => {
    child.send(`${JSON.stringify({ id: REQUEST_ID, type: "get_available_commands" })}\n`);
    for await (const line of child.lines) {
      const commands = parseOmpCommandsResponse(line);
      if (commands) return { ok: true, commands };
    }
    return { ok: false, reason: "no_response" };
  })();
  try {
    return await Promise.race([
      read,
      new Promise<OmpProbeResult>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, reason: "timeout" }),
          input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch {
    return { ok: false, reason: "spawn_error" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // omp's RPC mode never exits on its own; the probe always ends it.
    child.kill();
  }
}
