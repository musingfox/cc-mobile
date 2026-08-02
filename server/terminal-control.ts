/**
 * terminal-control.ts — handlers for the terminal_create / terminal_teardown WS messages.
 *
 * These used to live inline in ws.ts behind a hand-rolled parser that ran ahead
 * of the Zod gate. Both messages are now ClientMessage union members, so ws.ts
 * only dispatches and these handlers own the behaviour: path validation, the
 * reply shapes, and the error-code mapping.
 *
 * The backend is typed structurally (only the two methods used) rather than
 * against the TerminalBackend port, so the handlers depend on nothing beyond
 * what they call. The port satisfies this shape.
 */

import { expandPath, validateAllowedPath, validateCwd } from "./path-utils";

/** The slice of the terminal backend these handlers need. */
export interface TerminalControlBackend {
  createSession(params: {
    claudeUuid: string;
    cwd: string;
  }): Promise<{ name: string; paneRef: string }>;
  /**
   * Idempotent: an unknown session resolves to `{killed:false}` rather than
   * throwing. A pane cc-mobile did not launch answers `{killed:false,
   * reason:"not_owned"}` and issues no RPC at all (Decision M13).
   */
  teardown(sessionId: string): Promise<{ killed: boolean; reason?: "not_owned" }>;
}

export interface TerminalControlDeps {
  backend: TerminalControlBackend;
  allowedRoots: string[] | null;
  send: (msg: Record<string, unknown>) => void;
}

/**
 * Creates a terminal session for an already-validated `{claudeUuid, cwd}`.
 *
 * Replies `terminal_created`, or an error carrying one of invalid_cwd /
 * path_not_allowed / terminal_error.
 */
export async function handleTerminalCreate(
  msg: { claudeUuid: string; cwd: string },
  deps: TerminalControlDeps,
): Promise<void> {
  const { backend, allowedRoots, send } = deps;
  try {
    const cwd = expandPath(msg.cwd);

    const cwdError = validateCwd(cwd);
    if (cwdError) {
      send({ type: "error", code: "invalid_cwd", message: cwdError });
      return;
    }

    if (!validateAllowedPath(cwd, allowedRoots)) {
      send({
        type: "error",
        code: "path_not_allowed",
        message: "Project path is not in the allowed roots",
      });
      return;
    }

    const info = await backend.createSession({ claudeUuid: msg.claudeUuid, cwd });
    send({
      type: "terminal_created",
      claudeUuid: msg.claudeUuid,
      terminalName: info.name,
      paneRef: info.paneRef,
    });
  } catch (error) {
    send({
      type: "error",
      code: "terminal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Tears down the session, replying with `terminal_teardown_result`. An unknown
 * session is not an error — it reports `killed:false`.
 *
 * A session cc-mobile does not own is refused: the phone renders a close control
 * on every card, and on a foreign card honouring it would close the terminal the
 * user is sitting in (Decision M13). The reply carries both key names during the
 * migration window, so a client on either side of the re-key can match it.
 */
export async function handleTerminalTeardown(
  msg: { sessionId?: string; claudeUuid?: string },
  deps: Pick<TerminalControlDeps, "backend" | "send">,
): Promise<void> {
  const { backend, send } = deps;
  const sessionId = msg.sessionId ?? msg.claudeUuid;
  if (!sessionId) {
    send({
      type: "error",
      code: "invalid_message",
      message: "terminal_teardown requires sessionId",
    });
    return;
  }

  try {
    const result = await backend.teardown(sessionId);
    if (result.reason === "not_owned") {
      send({
        type: "error",
        code: "session_not_owned",
        sessionId,
        message:
          "This session belongs to a terminal you opened yourself; cc-mobile will not close it.",
      });
      return;
    }
    send({
      type: "terminal_teardown_result",
      sessionId,
      claudeUuid: sessionId,
      killed: result.killed,
    });
  } catch (error) {
    send({
      type: "error",
      code: "terminal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
