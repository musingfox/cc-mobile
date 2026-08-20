/**
 * request-gate-origin.test.ts — the Origin rung, rung by rung.
 *
 * Why the rule is driven directly instead of through `app.handle(new Request())`:
 * `Host`, `Upgrade` and `Origin` are forbidden header names in the fetch spec,
 * so the `Request` constructor silently drops all three (measured under this
 * repo's `bun test`, whose `happy-dom` preload installs a spec-compliant
 * `Request`). A `handle()` test would hand the gate a request with no `Upgrade`
 * header at all and pass while proving nothing. A standalone `Headers` keeps
 * them, which is what these cases build, and the end-to-end claim — that the
 * rung actually refuses a real handshake — is proven over a real socket in
 * `app-upgrade-gate.test.ts`.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { evaluateRequestGate } from "../request-gate";
import { cleanupGateHarness, gatedApp } from "./app-gate-harness";

afterAll(cleanupGateHarness);

function gate(headers: Record<string, string>, env: Record<string, string | undefined> = {}) {
  return evaluateRequestGate({ headers: new Headers(headers) }, env);
}

async function denial(response: Response | undefined) {
  if (!response) return { status: 200, body: "<no gate response>" };
  return { status: response.status, body: await response.text() };
}

const UPGRADE = { Upgrade: "websocket" };

describe("OriginGateOnUpgrade", () => {
  it("allows an upgrade that carries no Origin at all (native clients send none)", () => {
    expect(gate({ ...UPGRADE, Host: "localhost" })).toBeUndefined();
  });

  it('refuses the opaque origin "null", which is not the same as an absent header', async () => {
    expect(await denial(gate({ ...UPGRADE, Host: "localhost", Origin: "null" }))).toEqual({
      status: 403,
      body: "forbidden: origin",
    });
  });

  it("allows dev through the Vite /ws proxy, which forwards Host and Origin verbatim", () => {
    expect(
      gate({ ...UPGRADE, Host: "localhost:5173", Origin: "http://localhost:5173" }),
    ).toBeUndefined();
  });

  it("allows the production PWA over tailscale serve, which does not rewrite Host", () => {
    expect(
      gate({
        ...UPGRADE,
        Host: "nick-mac-mini.tail361ef.ts.net",
        Origin: "https://nick-mac-mini.tail361ef.ts.net",
      }),
    ).toBeUndefined();
  });

  it("refuses a drive-by connection from someone else's page", async () => {
    expect(
      await denial(gate({ ...UPGRADE, Host: "localhost:3001", Origin: "https://evil.example" })),
    ).toEqual({ status: 403, body: "forbidden: origin" });
  });

  it("accepts any origin named in CC_MOBILE_ALLOWED_ORIGINS, trimmed and slash-stripped", () => {
    expect(
      gate(
        { ...UPGRADE, Host: "localhost:3001", Origin: "https://evil.example" },
        { CC_MOBILE_ALLOWED_ORIGINS: " https://evil.example/ " },
      ),
    ).toBeUndefined();
  });

  it("denies an unparseable Origin instead of throwing", async () => {
    expect(await denial(gate({ ...UPGRADE, Host: "localhost:3001", Origin: "not a url" }))).toEqual(
      { status: 403, body: "forbidden: origin" },
    );
  });

  it("never origin-checks a non-upgrade request, because the dev /api proxy rewrites Host", async () => {
    // Same mismatch that is refused above, minus the Upgrade header.
    expect(gate({ Host: "localhost:3001", Origin: "http://localhost:5173" })).toBeUndefined();

    // And through the assembled server: an ordinary HTTP call reaches its route.
    const response = await gatedApp({}).handle(new Request("http://localhost/api/push/public-key"));
    expect(response.status).not.toBe(403);
    expect(await response.text()).not.toContain("origin");
  });
});
