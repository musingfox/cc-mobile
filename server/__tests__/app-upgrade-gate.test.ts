/**
 * app-upgrade-gate.test.ts — the claim no synthetic request can witness: a
 * refused connection never becomes a WebSocket at all.
 *
 * These go through a real handshake against `createApp(...).listen(0)`, because
 * "no socket exists" is a property of the socket, not of a status code. A
 * rejection surfaces on the client as an `error` event with no close frame, so
 * every assertion here is on `error` / `open`, never on a close code.
 *
 * The client is `ws`'s (Bun's native implementation of it) rather than the
 * global `WebSocket`: this repo's `bun test` preloads happy-dom, whose global
 * WebSocket takes no options object — so no custom headers — and announces
 * itself with `Origin: null`. The live e2e suites run with `--config=/dev/null`
 * (no preload) and therefore use Bun's own client, which sends no `Origin` at
 * all; that is the shape the dormant-gate case pins.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { WebSocket } from "ws";
import { cleanupGateHarness, listenGatedApp } from "./app-gate-harness";

afterAll(cleanupGateHarness);

interface Attempt {
  outcome: "open" | "error" | "timeout";
  frames: unknown[];
}

/** One handshake attempt; resolves as soon as it is decided either way. */
async function attemptUpgrade(port: number, headers: Record<string, string>): Promise<Attempt> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  const frames: unknown[] = [];
  socket.onmessage = (event) => frames.push(event.data);
  let opened = false;
  try {
    const outcome = await new Promise<Attempt["outcome"]>((resolve) => {
      socket.onopen = () => {
        opened = true;
        resolve("open");
      };
      socket.onerror = () => resolve("error");
      setTimeout(() => resolve("timeout"), 3000);
    });
    // Give a refused attempt every chance to still say something.
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { outcome, frames };
  } finally {
    if (opened) socket.close();
    else socket.terminate?.();
  }
}

describe("UpgradeRejectedBeforeSocket", () => {
  it("refuses the upgrade of a caller whose tailnet identity is not the trusted one", async () => {
    const server = listenGatedApp({ CC_MOBILE_TRUSTED_USER: "nick@example.com" });
    try {
      const attempt = await attemptUpgrade(server.port, {
        "Tailscale-User-Login": "intruder@example.com",
      });
      expect(attempt.outcome).toBe("error");
      expect(attempt.frames).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("still opens for the trusted identity", async () => {
    const server = listenGatedApp({ CC_MOBILE_TRUSTED_USER: "nick@example.com" });
    try {
      const attempt = await attemptUpgrade(server.port, {
        "Tailscale-User-Login": "nick@example.com",
      });
      expect(attempt.outcome).toBe("open");
    } finally {
      server.close();
    }
  });

  it("refuses a cross-site upgrade even while the identity rung is dormant", async () => {
    const server = listenGatedApp({});
    try {
      const attempt = await attemptUpgrade(server.port, { Origin: "https://evil.example" });
      expect(attempt.outcome).toBe("error");
      expect(attempt.frames).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("opens for a page served from this server's own origin", async () => {
    const server = listenGatedApp({});
    try {
      const attempt = await attemptUpgrade(server.port, {
        Origin: `http://127.0.0.1:${server.port}`,
      });
      expect(attempt.outcome).toBe("open");
    } finally {
      server.close();
    }
  });
});
