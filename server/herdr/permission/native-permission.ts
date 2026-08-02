/**
 * native-permission.ts — NativePermissionRequestEmit + PermissionAnswerKeySend.
 *
 * The permission flow with no hook pipeline behind it: herdr reports a pane as
 * `blocked`, cc-mobile reads the prompt off the screen, shows it on the phone in
 * the terminal's own wording, and presses the chosen key in the pane. That works
 * for every claude on the machine, including ones cc-mobile never launched —
 * which a PreToolUse hook installed by cc-mobile could never do.
 *
 * The one hard rule here is the fire-time guard. Live wire fact (probe
 * 2026-08-02): `esc` at claude's first-run trust dialog means "No, exit" and
 * kills claude, and herdr reports that dialog as `idle`, not `blocked`. So no
 * keystroke is ever sent on remembered state: every send re-reads
 * `agent_status` AND re-reads + re-parses the screen, and aborts unless the pane
 * is still `blocked` with the same prompt the user was answering (Decision M8).
 * Arming state is never trusted at fire time.
 */

import { type ParsedPrompt, type PromptOption, parseBlockedPrompt } from "./prompt-parse";

export type ClientSink = (msg: Record<string, unknown>) => void;

/** The pane slice of the herdr client this module drives. */
export interface NativePermissionClient {
  agentGet(target: string): Promise<{ agent_status?: string }>;
  paneRead(params: {
    pane_id: string;
    source: "detection";
  }): Promise<{ text: string; revision: number }>;
  paneSendKeys(paneId: string, keys: string[]): Promise<void>;
}

export interface NativePermissionOptions {
  client: NativePermissionClient;
  /** Late-bound: a reconnect rebinds the session to a fresh sink. */
  getSink: (sessionId: string) => ClientSink | undefined;
  /**
   * Who launched the pane. Decides nothing about the user's own answer; it is
   * the gate on the automated deny (Decision H2), so it is recorded at emit time
   * rather than looked up when a timer fires.
   */
  originOf?: (sessionId: string) => Promise<"self" | "foreign"> | "self" | "foreign";
  newRequestId?: () => string;
  warn?: (message: string) => void;
}

/** What the option list degrades to when the screen cannot be parsed. */
export const CANCEL_ONLY_OPTIONS: PromptOption[] = [
  { id: "cancel", label: "Cancel", keystroke: "esc" },
];

/** Fingerprint stand-in for a screen that carried a prompt we could not read. */
const UNPARSED_FINGERPRINT = "unparsed";

/** How much raw screen the unparseable fallback shows the user. */
const RAW_TAIL_LINES = 20;

export interface PendingNativePermission {
  requestId: string;
  /** herdr `pane_id` — the wire session key and the send target (Decision H5). */
  sessionId: string;
  fingerprint: string;
  /** The pane revision the prompt was read at; a staleness cursor for diagnostics. */
  paneRevision: number;
  origin: "self" | "foreign";
  options: PromptOption[];
}

function rawTail(text: string): string {
  return text.split("\n").slice(-RAW_TAIL_LINES).join("\n").trim();
}

export function createNativePermission(options: NativePermissionOptions) {
  const { client, getSink } = options;
  const originOf = options.originOf ?? (() => "foreign" as const);
  const newRequestId = options.newRequestId ?? (() => `perm-${crypto.randomUUID()}`);
  const warn =
    options.warn ?? ((message: string) => console.warn(`[herdr] permission: ${message}`));

  const pending = new Map<string, PendingNativePermission>();
  /** requestId → sessionId, so an answer finds its pane in one lookup. */
  const bySessionOfRequest = new Map<string, string>();
  let paused = false;

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function drop(sessionId: string): void {
    const entry = pending.get(sessionId);
    if (!entry) return;
    pending.delete(sessionId);
    bySessionOfRequest.delete(entry.requestId);
  }

  /** Reads the pane and parses it, or `undefined` when the read itself failed. */
  async function readPrompt(
    sessionId: string,
  ): Promise<{ parsed: ParsedPrompt | null; text: string; revision: number } | undefined> {
    try {
      const read = await client.paneRead({ pane_id: sessionId, source: "detection" });
      return {
        parsed: parseBlockedPrompt({ text: read.text }),
        text: read.text,
        revision: read.revision,
      };
    } catch (error) {
      warn(`${sessionId}: pane.read failed: ${describe(error)}`);
      return undefined;
    }
  }

  function emit(
    sessionId: string,
    sample: { parsed: ParsedPrompt | null; text: string; revision: number },
    origin: "self" | "foreign",
  ): PendingNativePermission {
    const requestId = newRequestId();
    const { parsed } = sample;

    const entry: PendingNativePermission = {
      requestId,
      sessionId,
      fingerprint: parsed?.fingerprint ?? UNPARSED_FINGERPRINT,
      paneRevision: sample.revision,
      origin,
      options: parsed ? parsed.options : CANCEL_ONLY_OPTIONS,
    };
    pending.set(sessionId, entry);
    bySessionOfRequest.set(requestId, sessionId);

    // An unreadable screen still raises a request: the user must be able to see
    // that something is waiting and cancel it, rather than watch a session sit
    // silently blocked.
    getSink(sessionId)?.({
      type: "permission_request",
      sessionId,
      requestId,
      tool: {
        name: parsed?.toolLabel || "Permission required",
        parameters: parsed
          ? {
              text: parsed.argumentText,
              ...(parsed.description ? { description: parsed.description } : {}),
            }
          : { text: rawTail(sample.text) },
      },
      options: entry.options,
    });

    return entry;
  }

  /**
   * One status observation for a pane, from the global `pane.updated` stream.
   *
   * Leaving `blocked` drops the pending record without a keystroke: whoever
   * answered — the human at the terminal, or the phone — has already been heard.
   */
  async function onStatus(sessionId: string, status: string): Promise<void> {
    if (status !== "blocked") {
      drop(sessionId);
      return;
    }

    const sample = await readPrompt(sessionId);
    if (!sample) return;

    const fingerprint = sample.parsed?.fingerprint ?? UNPARSED_FINGERPRINT;
    // Same question, seen twice: the phone already has it.
    if (pending.get(sessionId)?.fingerprint === fingerprint) return;

    emit(sessionId, sample, await originOf(sessionId));
  }

  function sendError(sessionId: string, code: string, message: string): void {
    getSink(sessionId)?.({ type: "error", code, message, sessionId });
  }

  /**
   * Answers a pending request by pressing a key in the pane.
   *
   * Returns whether this module owned the `requestId`. An id it does not know is
   * left entirely alone — no keystroke, and no error frame — so the caller can
   * fall through to another holder without the user seeing a spurious failure.
   */
  async function resolve(
    requestId: string,
    answer: { optionId?: string; allow?: boolean },
  ): Promise<boolean> {
    const sessionId = bySessionOfRequest.get(requestId);
    if (!sessionId) return false;
    const entry = pending.get(sessionId);
    if (!entry) return false;

    const keystroke = keystrokeFor(entry, answer);
    if (!keystroke) {
      sendError(
        sessionId,
        "permission_option_unknown",
        `Option ${answer.optionId ?? "(none)"} is not offered by this prompt.`,
      );
      return true;
    }

    const guard = await guardStillCurrent(entry);
    if (!guard) {
      drop(sessionId);
      sendError(
        sessionId,
        "permission_prompt_stale",
        "The prompt in the terminal changed before this answer arrived; nothing was sent.",
      );
      return true;
    }

    try {
      await client.paneSendKeys(sessionId, [keystroke]);
    } catch (error) {
      warn(`${sessionId}: pane.send_keys failed: ${describe(error)}`);
      sendError(
        sessionId,
        "permission_answer_failed",
        `Could not answer the prompt in ${sessionId}: ${describe(error)}`,
      );
      return true;
    }
    drop(sessionId);
    return true;
  }

  /**
   * Which key answers this request.
   *
   * The legacy `{allow}` form is mapped conservatively (Decision M14): a denial
   * becomes `esc`, and an approval becomes the terminal's FIRST option — the
   * one-shot "Yes". An old client's "allow for this session" therefore approves
   * once rather than granting a standing permission nobody re-confirmed.
   */
  function keystrokeFor(
    entry: PendingNativePermission,
    answer: { optionId?: string; allow?: boolean },
  ): string | undefined {
    if (answer.optionId !== undefined) {
      return entry.options.find((option) => option.id === answer.optionId)?.keystroke;
    }
    if (answer.allow === false) return "esc";
    if (answer.allow === true) return entry.options[0]?.keystroke;
    return undefined;
  }

  /**
   * The fire-time guard: two fresh reads, never the remembered state.
   *
   * `agent_status` proves *a* prompt is up; the fingerprint proves it is *the*
   * prompt the user answered. Without the second check, a human answering at the
   * terminal between emit and tap would let "press 2" approve something the user
   * on the phone never saw. Any RPC failure counts as "cannot prove it is
   * current" and blocks the keystroke.
   */
  async function guardStillCurrent(entry: PendingNativePermission): Promise<boolean> {
    try {
      const agent = await client.agentGet(entry.sessionId);
      if (agent.agent_status !== "blocked") return false;
    } catch (error) {
      warn(`${entry.sessionId}: agent.get failed, refusing to send keys: ${describe(error)}`);
      return false;
    }

    const sample = await readPrompt(entry.sessionId);
    if (!sample) return false;
    return (sample.parsed?.fingerprint ?? UNPARSED_FINGERPRINT) === entry.fingerprint;
  }

  /** Connection lost: keep the pending records, stop claiming the phone has seen them. */
  function pause(): void {
    paused = true;
  }

  /**
   * Reconnect: re-emit every still-live prompt as a FRESH request read from the
   * live screen, rather than replaying a stored payload. A prompt answered at
   * the terminal during the gap is dropped instead of re-shown (EX-C2).
   */
  async function resume(): Promise<void> {
    if (!paused) return;
    paused = false;
    for (const entry of [...pending.values()]) {
      let stillBlocked = false;
      try {
        stillBlocked = (await client.agentGet(entry.sessionId)).agent_status === "blocked";
      } catch (error) {
        warn(`${entry.sessionId}: agent.get failed on resume: ${describe(error)}`);
      }
      if (!stillBlocked) {
        drop(entry.sessionId);
        continue;
      }
      const sample = await readPrompt(entry.sessionId);
      if (!sample) continue;
      drop(entry.sessionId);
      emit(entry.sessionId, sample, entry.origin);
    }
  }

  /** Session gone: nothing left to answer. */
  function forget(sessionId: string): void {
    drop(sessionId);
  }

  function pendingFor(sessionId: string): PendingNativePermission | undefined {
    return pending.get(sessionId);
  }

  function pendingCount(): number {
    return pending.size;
  }

  return { onStatus, resolve, pause, resume, forget, pendingFor, pendingCount };
}

export type NativePermission = ReturnType<typeof createNativePermission>;
