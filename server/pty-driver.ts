/**
 * pty-driver.ts — PTY spawn abstraction for ADR-011 human-in-the-loop drive layer.
 *
 * Hard constraints:
 *   - NO top-level import of node-pty (node-pty lives only in pty-worker.mjs)
 *   - NO top-level import of SDK query() or getSessionMessages
 *   - SpawnerFn is the sole seam; real PTY wiring goes through the Node.js worker
 *
 * ToS note: driveOnce is triggered by a human action forwarded from the mobile UI.
 * This module contains no scheduling, no loops, no auto-approve logic.
 */

/**
 * A function that spawns a claude interactive process and returns a handle
 * for writing bytes to it.
 *
 * args:  argv passed to the process (e.g. ["claude", "--session-id", id])
 * cwd:   working directory for the spawned process
 * returns: { write(data), kill?, exited? } — write injects bytes as if typed at the keyboard;
 *          kill (optional) terminates the process; exited (optional) resolves when it ends
 */
export type SpawnerFn = (
  args: string[],
  cwd: string,
) => { write: (data: string) => void; kill?: () => void; exited?: Promise<number> };

/**
 * Resolve the absolute path to pty-worker.mjs.
 *
 * If PTY_WORKER env var is set, use it (test/override path).
 * Otherwise return the absolute path co-located with this module.
 * H-A fix: never return a relative fallback string — always absolute.
 */
export function resolveWorkerPath(): string {
  if (process.env.PTY_WORKER) {
    return process.env.PTY_WORKER;
  }
  // import.meta.dir is the absolute directory of this source file (Bun built-in)
  return import.meta.dir + "/pty-worker.mjs";
}

/**
 * Default spawner: lazy-starts the pty-worker.mjs subprocess via Bun.spawn.
 *
 * The worker path resolves via resolveWorkerPath() at call time (not import time)
 * so tests can swap PTY_WORKER after import.
 *
 * The worker process receives JSON commands on its stdin; responses come from
 * JSONL written to the session file — worker stdout is not needed and is set to
 * "ignore" to avoid accumulation (H-B fix).
 */
export function defaultSpawner(
  args: string[],
  cwd: string,
): { write: (data: string) => void; kill: () => void; exited: Promise<number> } {
  const workerPath = resolveWorkerPath();

  const proc = Bun.spawn(["node", workerPath, ...args], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "inherit",
    cwd,
    env: process.env,
  });

  // H-C fix: idempotent kill — guard with a flag so double-call is safe
  let killed = false;
  function kill(): void {
    if (killed) return;
    killed = true;
    try {
      proc.stdin.end();
    } catch {
      // stdin may already be closed
    }
    proc.kill("SIGTERM");
  }

  return {
    write(data: string): void {
      const msg = JSON.stringify({ type: "write", data }) + "\n";
      proc.stdin.write(new TextEncoder().encode(msg));
      // Flush Bun's FileSink buffer so the worker receives bytes immediately
      (proc.stdin as unknown as { flush?: () => void }).flush?.();
    },
    kill,
    exited: proc.exited,
  };
}

/**
 * PtyDriver — single-shot keyboard injection into an interactive claude process.
 *
 * Usage (human-triggered path only):
 *   const driver = new PtyDriver(spawner);
 *   driver.driveOnce(sessionId, cwd, prompt);
 */
export class PtyDriver {
  private readonly spawner: SpawnerFn;

  /**
   * @param spawner - Injectable spawn function. Omit to use the default worker-based spawner.
   */
  constructor(spawner?: SpawnerFn) {
    this.spawner = spawner ?? defaultSpawner;
  }

  /**
   * Single-shot: spawn once, write prompt + CR, done.
   *
   * Exactly one spawn, exactly one write. No event loop, no retry, no auto-approve.
   *
   * @param sessionId - SDK session ID passed as --session-id
   * @param cwd       - Working directory for the spawned process
   * @param prompt    - Text to inject, followed by "\r" (Enter)
   */
  driveOnce(
    sessionId: string,
    cwd: string,
    prompt: string,
  ): { kill: () => void; exited: Promise<number> } {
    const args = ["claude", "--session-id", sessionId];
    const proc = this.spawner(args, cwd);
    proc.write(`${prompt}\r`);
    return {
      kill: proc.kill ?? (() => {}),
      exited: proc.exited ?? Promise.resolve(0),
    };
  }
}
