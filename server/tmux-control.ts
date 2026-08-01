/**
 * tmux-control.ts — handlers for the tmux_create / tmux_teardown WS messages.
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
export interface TmuxControlBackend {
  createSession(params: {
    claudeUuid: string;
    cwd: string;
  }): Promise<{ name: string; panePid: number; settingsPath: string }>;
  /** Idempotent: an unknown uuid resolves to `{killed:false}` rather than throwing. */
  teardown(claudeUuid: string): Promise<{ killed: boolean }>;
}

export interface TmuxControlDeps {
  backend: TmuxControlBackend;
  allowedRoots: string[] | null;
  send: (msg: Record<string, unknown>) => void;
}

/**
 * Creates a tmux session for an already-validated `{claudeUuid, cwd}`.
 *
 * Replies `tmux_created`, or an error carrying one of invalid_cwd /
 * path_not_allowed / tmux_error.
 */
export async function handleTmuxCreate(
  msg: { claudeUuid: string; cwd: string },
  deps: TmuxControlDeps,
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
      type: "tmux_created",
      claudeUuid: msg.claudeUuid,
      tmuxName: info.name,
      panePid: info.panePid,
    });
  } catch (error) {
    send({
      type: "error",
      code: "tmux_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Tears down the tmux session for `claudeUuid`, replying with
 * `tmux_teardown_result`. An unknown uuid is not an error — it reports
 * `killed:false`.
 */
export async function handleTmuxTeardown(
  msg: { claudeUuid: string },
  deps: Pick<TmuxControlDeps, "backend" | "send">,
): Promise<void> {
  const { backend, send } = deps;
  try {
    const result = await backend.teardown(msg.claudeUuid);
    send({
      type: "tmux_teardown_result",
      claudeUuid: msg.claudeUuid,
      killed: result.killed,
    });
  } catch (error) {
    send({
      type: "error",
      code: "tmux_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
