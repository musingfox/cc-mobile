#!/usr/bin/env bun
/**
 * pty-permission-hook.ts — Claude hook script for PreToolUse permission relay.
 *
 * Reads JSON from stdin: { session_id, tool_use_id, tool_name, tool_input }
 * POSTs to CC_MOBILE_PERMISSION_URL (default: http://localhost:3001/api/pty-permission)
 * Writes exactly one JSON line to stdout.
 *
 * Always exits 0 — hook must not crash the parent claude process.
 *
 * Hard constraints:
 *   - NO top-level import of node-pty
 *   - NO top-level import of SDK
 *   - All logging goes to stderr, never stdout
 */

const PERMISSION_URL =
  process.env.CC_MOBILE_PERMISSION_URL ?? "http://localhost:3001/api/pty-permission";

// HTTP timeout: 620s (relay timeout is 600s, add headroom)
const HTTP_TIMEOUT_MS = 620000;

async function main(): Promise<void> {
  // Read stdin to completion
  const stdinText = await new Response(Bun.stdin.stream()).text();

  let payload: {
    session_id: string;
    tool_use_id: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
  };

  try {
    payload = JSON.parse(stdinText.trim());
  } catch (err) {
    process.stderr.write(`[pty-permission-hook] Failed to parse stdin JSON: ${err}\n`);
    writeOutput("deny", "invalid_stdin_json");
    return;
  }

  const { session_id, tool_use_id, tool_name, tool_input } = payload;

  let allow = false;
  let reason: string | undefined;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(PERMISSION_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id, tool_use_id, tool_name, tool_input }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      if (response.status === 404) {
        reason = `session_not_found: ${errText}`;
      } else {
        reason = `http_error_${response.status}: ${errText}`;
      }
      allow = false;
    } else {
      const body = (await response.json()) as { allow?: boolean };
      allow = body.allow === true;
      if (!allow) {
        reason = "denied_by_server";
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Connection refused, timeout, DNS failure, etc.
    if (errMsg.includes("ECONNREFUSED") || errMsg.includes("connect")) {
      reason = `unreachable: ${errMsg}`;
    } else if (errMsg.includes("abort") || errMsg.includes("timeout")) {
      reason = `timeout: ${errMsg}`;
    } else {
      reason = `error: ${errMsg}`;
    }
    allow = false;
    process.stderr.write(`[pty-permission-hook] Request failed: ${errMsg}\n`);
  }

  writeOutput(allow ? "allow" : "deny", allow ? undefined : reason);
}

function writeOutput(
  permissionDecision: "allow" | "deny",
  permissionDecisionReason?: string,
): void {
  const output: Record<string, unknown> = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      ...(permissionDecisionReason !== undefined ? { permissionDecisionReason } : {}),
    },
  };
  // Only one write to stdout — must be clean JSON
  process.stdout.write(JSON.stringify(output) + "\n");
}

main().catch((err) => {
  process.stderr.write(`[pty-permission-hook] Fatal: ${err}\n`);
  writeOutput("deny", `fatal: ${err}`);
});
