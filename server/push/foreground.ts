/**
 * foreground.ts — whether a device is looking at cc-mobile right now.
 *
 * The suppression has to happen here, before anything is sent: iOS revokes a
 * subscription whose pushes arrive without showing a notification, so the
 * service worker cannot quietly swallow one the user is already looking at.
 *
 * The evidence is a live WebSocket whose page last said it was visible. It is
 * kept per connection, not per device: a reconnect overlaps the old socket's
 * close, and that late close must not erase what the new socket just reported.
 *
 * A visible report expires. A phone that locks may never get its `hidden` frame
 * out, and the socket can outlive the page by minutes (Bun's idle timeout), so
 * "visible" is believed only while the page keeps repeating it. Anything not
 * proven — no report, an expired one, a closed socket, a device never heard
 * of — answers "not foreground", and the push goes out: an extra buzz costs
 * less than a `blocked` nobody hears about.
 */

/**
 * How long one `visible` report is believed. The client repeats it every
 * `VISIBILITY_HEARTBEAT_MS` (client/services/ws-service.ts); this allows one
 * lost repeat, and bounds what a missed `hidden` can suppress to seconds.
 */
export const FOREGROUND_FRESH_MS = 25_000;

export type VisibilityState = "visible" | "hidden";

export interface ForegroundTracker {
  /** A connection's page reported its visibility. `device` null → untracked. */
  report(connection: unknown, device: string | null, state: VisibilityState): void;
  /** The connection closed. */
  drop(connection: unknown): void;
  /** Whether some live connection of this device is visible, as of now. */
  isForeground(device: string): boolean;
}

export function createForegroundTracker(opts: { now?: () => number } = {}): ForegroundTracker {
  const now = opts.now ?? Date.now;
  const connections = new Map<unknown, { device: string; visible: boolean; at: number }>();

  return {
    report(connection, device, state) {
      // A connection without a device name cannot be matched to any
      // subscription, so there is nothing for it to suppress.
      if (!device) return;
      connections.set(connection, { device, visible: state === "visible", at: now() });
    },

    drop(connection) {
      connections.delete(connection);
    },

    isForeground(device) {
      const at = now();
      for (const entry of connections.values()) {
        if (entry.device === device && entry.visible && at - entry.at < FOREGROUND_FRESH_MS) {
          return true;
        }
      }
      return false;
    },
  };
}
