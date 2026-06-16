/**
 * pty-response-endpoint.ts — HTTP handler for POST /api/pty-response.
 *
 * Receives the Stop-hook delivery of the assistant reply and resolves the in-flight
 * drive() waiting on the response relay (ADR-011 readback for claude v2.1.177).
 *
 * Hard constraints:
 *   - NO top-level import of node-pty
 *   - NO top-level import of SDK
 *   - Standalone: accepts relay seam so tests can mock it
 */

import type { createPtyResponseRelay } from "./pty-response-relay";

type RelayInstance = ReturnType<typeof createPtyResponseRelay>;

interface PtyResponseHandlerOptions {
  relay: RelayInstance;
}

/**
 * Factory that returns a `fetch`-compatible request handler.
 *
 * The handler accepts:
 *   POST /api/pty-response
 *   Body: { session_id, text }
 *
 * Responses:
 *   200  { ok: true }                    — response delivered to a waiting drive()
 *   404  { error: "no_pending_response" } — no in-flight drive awaiting this session
 */
export function createPtyResponseHandler(
  options: PtyResponseHandlerOptions,
): (req: Request) => Promise<Response> {
  const { relay } = options;

  return async function handler(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    let body: { session_id: string; text?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const { session_id, text } = body;

    const delivered = relay.resolveResponse(session_id, text ?? "");
    if (!delivered) {
      return new Response(JSON.stringify({ error: "no_pending_response" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
