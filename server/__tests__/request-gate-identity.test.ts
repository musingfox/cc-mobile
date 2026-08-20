/**
 * request-gate-identity.test.ts — the Tailscale identity rung, dormant and armed.
 *
 * `Tailscale-User-Login` is not a forbidden header name, so unlike the Origin
 * rung these cases can be driven through the assembled server with
 * `app.handle()` and read as plain HTTP statuses. The claim that the same rung
 * also refuses a *WebSocket upgrade* — the one that matters, since the socket is
 * the way in — is proven over a real handshake in `app-upgrade-gate.test.ts`.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { WebSocket } from "ws";
import { evaluateRequestGate } from "../request-gate";
import { cleanupGateHarness, gatedApp, listenGatedApp } from "./app-gate-harness";

afterAll(cleanupGateHarness);

const TRUSTED = "nick@example.com";
const PUBLIC_KEY_URL = "http://localhost/api/push/public-key";

function get(
  url: string,
  headers: Record<string, string>,
  gateEnv?: Record<string, string | undefined>,
) {
  return gatedApp(gateEnv).handle(new Request(url, { headers }));
}

describe("IdentityGateDormantWhenUnset", () => {
  it("leaves an ordinary request untouched, and ignores an identity header a client made up", async () => {
    const plain = await get(PUBLIC_KEY_URL, {}, {});
    expect(plain.status).not.toBe(403);

    // A client-supplied header traverses the Vite proxy end-to-end; while the
    // rung is dormant it buys the caller exactly nothing.
    const spoofed = await get(
      PUBLIC_KEY_URL,
      { "Tailscale-User-Login": "spoofed@example.com" },
      {},
    );
    expect(spoofed.status).toBe(plain.status);
  });

  it("lets a headerless WebSocket upgrade through, as the live e2e harness makes it", async () => {
    // The rule, on the header shape a `Request` cannot carry:
    expect(
      evaluateRequestGate(
        { headers: new Headers({ Upgrade: "websocket", Host: "localhost" }) },
        {},
      ),
    ).toBeUndefined();

    // And over a real handshake sending nothing — the shape the live e2e
    // harness connects in (it runs with no happy-dom preload, so its client is
    // Bun's own, which sends no `Origin` header at all).
    const server = listenGatedApp({});
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    try {
      const outcome = await new Promise<string>((resolve) => {
        socket.onopen = () => resolve("open");
        socket.onerror = () => resolve("error");
        setTimeout(() => resolve("timeout"), 3000);
      });
      expect(outcome).toBe("open");
      socket.close();
    } finally {
      server.close();
    }
  });

  it("treats a whitespace-only CC_MOBILE_TRUSTED_USER as unset", async () => {
    const response = await get(PUBLIC_KEY_URL, {}, { CC_MOBILE_TRUSTED_USER: "   " });
    expect(response.status).not.toBe(403);
  });
});

describe("IdentityGateEnforcedOnHttp", () => {
  const armed = { CC_MOBILE_TRUSTED_USER: TRUSTED };

  it("lets the trusted identity through", async () => {
    const response = await get(PUBLIC_KEY_URL, { "Tailscale-User-Login": TRUSTED }, armed);
    expect(response.status).not.toBe(403);
  });

  it("refuses another tailnet identity without naming the configured one", async () => {
    const response = await get(
      PUBLIC_KEY_URL,
      { "Tailscale-User-Login": "intruder@example.com" },
      armed,
    );
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toBe("forbidden: identity");
    expect(body).not.toContain(TRUSTED);
  });

  it("refuses a request carrying no identity header at all", async () => {
    const response = await get(PUBLIC_KEY_URL, {}, armed);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("forbidden: identity");
  });

  it("covers unknown paths too, because the gate runs before routing", async () => {
    const response = await get("http://localhost/some/spa/route", {}, armed);
    expect(response.status).toBe(403);
  });

  it("trims both sides before comparing", async () => {
    const response = await get(
      PUBLIC_KEY_URL,
      { "Tailscale-User-Login": TRUSTED },
      {
        CC_MOBILE_TRUSTED_USER: ` ${TRUSTED} `,
      },
    );
    expect(response.status).not.toBe(403);
  });

  it("reads process.env when nothing is injected — the injection is a test seam, not the binding", async () => {
    const saved = process.env.CC_MOBILE_TRUSTED_USER;
    try {
      process.env.CC_MOBILE_TRUSTED_USER = TRUSTED;
      const response = await get(PUBLIC_KEY_URL, {
        "Tailscale-User-Login": "intruder@example.com",
      });
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("forbidden: identity");
    } finally {
      if (saved === undefined) delete process.env.CC_MOBILE_TRUSTED_USER;
      else process.env.CC_MOBILE_TRUSTED_USER = saved;
    }
  });
});
