/**
 * pty-driver.ts — PTY spawn abstraction for ADR-011 human-in-the-loop drive layer.
 *
 * Hard constraints:
 *   - NO top-level import of node-pty (parked decision: Node.js worker vs script(1))
 *   - NO top-level import of SDK query() or getSessionMessages
 *   - SpawnerFn is the sole seam; real PTY wiring is the next slice's job
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
 * Default spawner placeholder.
 *
 * Real PTY transport (Node.js worker or macOS script(1)) is a parked one-way door.
 * See .spiral/state.json parked_decisions. The next slice that wires a real spawner
 * will replace this default.
 *
 * Called (not at construction) so the error surfaces at driveOnce() time, not import time.
 */
function defaultSpawner(_args: string[], _cwd: string): { write: (data: string) => void } {
  throw new Error(
    "real PTY spawner not wired yet — parked decision: Node.js worker vs script(1), see .spiral/state.json",
  );
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
   * @param spawner - Injectable spawn function. Omit to get the parked-decision placeholder.
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
