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
 * returns: { write(data) } — write injects bytes as if typed at the keyboard
 */
export type SpawnerFn = (args: string[], cwd: string) => { write: (data: string) => void };

/**
 * Default spawner: lazy-starts the pty-worker.mjs subprocess via Bun.spawn.
 *
 * The worker path is read from PTY_WORKER env var at call time (not import time)
 * so tests can swap it after import.
 *
 * The worker process receives JSON commands on its stdin and emits JSON events
 * on its stdout (see pty-worker.mjs for the protocol).
 */
function defaultSpawner(args: string[], cwd: string): { write: (data: string) => void } {
  const workerPath = process.env.PTY_WORKER ?? "server/pty-worker.mjs";

  const proc = Bun.spawn(["node", workerPath, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    cwd,
    env: process.env,
  });

  return {
    write(data: string): void {
      const msg = JSON.stringify({ type: "write", data }) + "\n";
      proc.stdin.write(new TextEncoder().encode(msg));
      // Flush Bun's FileSink buffer so the worker receives bytes immediately
      (proc.stdin as unknown as { flush?: () => void }).flush?.();
    },
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
  driveOnce(sessionId: string, cwd: string, prompt: string): void {
    const args = ["claude", "--session-id", sessionId];
    const proc = this.spawner(args, cwd);
    proc.write(`${prompt}\r`);
  }
}
