/**
 * pty-response-endpoint.test.ts — Unit tests for createPtyResponseHandler.
 *
 * Mocks the relay seam; no HTTP server, no claude. Covers the handler's branches:
 *   1. delivered → 200 { ok: true }, relay called with (session_id, text)
 *   2. no pending waiter → 404 { error: "no_pending_response" }
 *   3. missing text defaults to "" passed to relay
 *   4. invalid JSON → 400
 *   5. non-POST → 405
 */

import { describe, expect, it } from "bun:test";
import { createPtyResponseHandler } from "./pty-response-endpoint";

type RelayStub = Parameters<typeof createPtyResponseHandler>[0]["relay"];

/** Minimal relay stub: only resolveResponse is exercised by the handler. */
function makeRelay(delivered: boolean) {
  const calls: Array<{ sessionId: string; text: string }> = [];
  const relay = {
    resolveResponse: (sessionId: string, text: string) => {
      calls.push({ sessionId, text });
      return delivered;
    },
    awaitResponse: async () => "",
    hasPending: () => false,
    getPendingCount: () => 0,
  } as unknown as RelayStub;
  return { relay, calls };
}

function postReq(body: unknown): Request {
  return new Request("http://x/api/pty-response", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("createPtyResponseHandler", () => {
  it("delivers to a waiting drive → 200 ok, relay called with session+text", async () => {
    const { relay, calls } = makeRelay(true);
    const handler = createPtyResponseHandler({ relay });

    const res = await handler(postReq({ session_id: "s1", text: "PONG" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ sessionId: "s1", text: "PONG" }]);
  });

  it("no pending waiter → 404 no_pending_response", async () => {
    const { relay } = makeRelay(false);
    const handler = createPtyResponseHandler({ relay });

    const res = await handler(postReq({ session_id: "ghost", text: "x" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_pending_response" });
  });

  it("missing text defaults to empty string", async () => {
    const { relay, calls } = makeRelay(true);
    const handler = createPtyResponseHandler({ relay });

    await handler(postReq({ session_id: "s1" }));
    expect(calls[0]).toEqual({ sessionId: "s1", text: "" });
  });

  it("invalid JSON → 400", async () => {
    const { relay } = makeRelay(true);
    const handler = createPtyResponseHandler({ relay });

    const res = await handler(postReq("{not json"));
    expect(res.status).toBe(400);
  });

  it("non-POST → 405", async () => {
    const { relay } = makeRelay(true);
    const handler = createPtyResponseHandler({ relay });

    const res = await handler(new Request("http://x/api/pty-response", { method: "GET" }));
    expect(res.status).toBe(405);
  });
});
