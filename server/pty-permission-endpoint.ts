/**
 * pty-permission-endpoint.ts — HTTP handler for POST /api/pty-permission.
 *
 * Hard constraints:
 *   - NO top-level import of node-pty
 *   - NO top-level import of SDK
 *   - Standalone: accepts relay + session-check seam so tests can mock both
 */

import type { createPtyPermissionRelay } from "./pty-permission-relay";

type RelayInstance = ReturnType<typeof createPtyPermissionRelay>;

interface PtyPermissionHandlerOptions {
  relay: RelayInstance;
  /** Return true if the given session_id has an active connection */
  hasSession: (sessionId: string) => boolean;
}

/**
 * Factory that returns a `fetch`-compatible request handler.
 *
 * The handler accepts:
 *   POST /api/pty-permission
 *   Body: { session_id, tool_use_id, tool_name, tool_input }
 *
 * Responses:
 *   200  { allow: boolean }   — permission resolved
 *   404  { error: "session_not_found" }  — session not active
 */
export function createPtyPermissionHandler(
  options: PtyPermissionHandlerOptions,
): (req: Request) => Promise<Response> {
  const { relay, hasSession } = options;

  return async function handler(req: Request): Promise<Response> {
    // Only handle POST /api/pty-permission (or the root "/" for test servers on bare port)
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    let body: {
      session_id: string;
      tool_use_id: string;
      tool_name: string;
      tool_input: Record<string, unknown>;
    };

    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const { session_id, tool_use_id, tool_name, tool_input } = body;

    // EX-10: unknown session → 404 before sendToClient fires
    if (!hasSession(session_id)) {
      return new Response(JSON.stringify({ error: "session_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    // EX-9: await relay; sendToClient is called synchronously inside requestPtyPermission
    const result = await relay.requestPtyPermission({
      sessionId: session_id,
      toolUseId: tool_use_id,
      toolName: tool_name,
      toolInput: tool_input ?? {},
    });

    return new Response(JSON.stringify({ allow: result.allow }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
