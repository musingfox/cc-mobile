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

import { ompAnswerKeys } from "./omp-prompt";
import {
  type ParsedPrompt,
  type PromptDialect,
  type PromptOption,
  parseBlockedPrompt,
} from "./prompt-parse";

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
  /** How long an unanswered prompt on a self-launched pane may hold a turn. */
  timeoutMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
  now?: () => number;
  warn?: (message: string) => void;
  /**
   * Announce a permission prompt for push (background notification) even when
   * no phone/sink is attached. Called for every emitted request (self-filter
   * is elsewhere). Must be called regardless of getSink result.
   */
  onPermissionPrompt?: (sessionId: string, origin: "self" | "foreign") => Promise<void> | void;
  /**
   * An omp blocked screen that is not a permission prompt: hand the raw text
   * to the announcement path instead of raising an unanswerable card.
   */
  onUnparsedBlockedScreen?: (sessionId: string, screen: string) => void | Promise<void>;
  /** 稽核只接收列舉結果，不接收 prompt、答案或錯誤文字。 */
  onKeysSent?: (
    sessionId: string,
    source: "permission_answer" | "auto_deny",
    outcome: "sent" | "failed",
  ) => Promise<void> | void;
}

/**
 * #24's unattended-safety budget, carried forward: a prompt nobody answers must
 * not hold a turn open indefinitely.
 */
export const UNATTENDED_DENY_MS = 90_000;

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
  /**
   * Whose prompt this is. Absent when the screen could not be parsed at all,
   * where the only offered action is Cancel and `esc` is the only key sent.
   */
  dialect?: PromptDialect;
  /** The pane revision the prompt was read at; a staleness cursor for diagnostics. */
  paneRevision: number;
  origin: "self" | "foreign";
  options: PromptOption[];
  /** Countdown bookkeeping for the unattended deny; absent on foreign panes. */
  timerId?: unknown;
  armedAt?: number;
  /** Countdown already spent, carried across a disconnect (the frozen countdown). */
  elapsedMs: number;
}

function rawTail(text: string): string {
  return text.split("\n").slice(-RAW_TAIL_LINES).join("\n").trim();
}

export function createNativePermission(options: NativePermissionOptions) {
  const { client, getSink } = options;
  const originOf = options.originOf ?? (() => "foreign" as const);
  const newRequestId = options.newRequestId ?? (() => `perm-${crypto.randomUUID()}`);
  const timeoutMs = options.timeoutMs ?? UNATTENDED_DENY_MS;
  const setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const now = options.now ?? (() => Date.now());
  const warn =
    options.warn ?? ((message: string) => console.warn(`[herdr] permission: ${message}`));
  const onPermissionPrompt = options.onPermissionPrompt ?? (() => {});
  const onUnparsedBlockedScreen = options.onUnparsedBlockedScreen ?? (() => {});
  const onKeysSent = options.onKeysSent ?? (() => {});

  const pending = new Map<string, PendingNativePermission>();
  /** requestId → sessionId, so an answer finds its pane in one lookup. */
  const bySessionOfRequest = new Map<string, string>();
  let paused = false;

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function reportKeys(
    sessionId: string,
    source: "permission_answer" | "auto_deny",
    outcome: "sent" | "failed",
  ): Promise<void> {
    try {
      await onKeysSent(sessionId, source, outcome);
    } catch {
      // 稽核觀察者失敗不能影響送鍵結果。
    }
  }

  function drop(sessionId: string): void {
    const entry = pending.get(sessionId);
    if (!entry) return;
    if (entry.timerId !== undefined) clearTimeoutFn(entry.timerId);
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
    elapsedMs = 0,
  ): PendingNativePermission {
    const requestId = newRequestId();
    const { parsed } = sample;

    const entry: PendingNativePermission = {
      requestId,
      sessionId,
      fingerprint: parsed?.fingerprint ?? UNPARSED_FINGERPRINT,
      ...(parsed ? { dialect: parsed.dialect } : {}),
      paneRevision: sample.revision,
      origin,
      options: parsed ? parsed.options : CANCEL_ONLY_OPTIONS,
      elapsedMs,
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

    // PushPermissionTrigger: announce every parsed (incl. unparseable fallback)
    // permission prompt, whether or not phone attached (getSink may be undef).
    // Call for any origin here; self-filter is in caller. After sink, before arm.
    // The collaborator is contained both ways: a synchronous throw is caught
    // here, and a rejected promise is caught off the same call rather than
    // escaping as an unhandled rejection. Either way the pending entry is
    // registered and the deny timer is armed.
    try {
      Promise.resolve(onPermissionPrompt(sessionId, origin)).catch((error: unknown) => {
        warn(`onPermissionPrompt rejected for ${sessionId}: ${describe(error)}`);
      });
    } catch (error) {
      warn(`onPermissionPrompt threw for ${sessionId}: ${describe(error)}`);
    }

    armDeny(entry);
    return entry;
  }

  /**
   * Starts the unattended countdown — on a pane cc-mobile launched, and nowhere
   * else.
   *
   * On a session the user opened in their own terminal somebody is demonstrably
   * at the keyboard, and cancelling a prompt they are still reading would be
   * cc-mobile answering for them (Decision H2). Where cc-mobile IS the only
   * operator, an unanswered prompt holding a turn forever is the failure #24
   * exists to prevent.
   */
  function armDeny(entry: PendingNativePermission): void {
    if (entry.origin !== "self" || paused) return;
    const remaining = timeoutMs - entry.elapsedMs;
    entry.armedAt = now();
    entry.timerId = setTimeoutFn(
      () => {
        void denyUnattended(entry.requestId);
      },
      Math.max(0, remaining),
    );
  }

  /**
   * The automated answer, and the only one cc-mobile ever sends by itself: `esc`
   * — never a digit, never Enter. Nothing here can approve a tool call.
   *
   * The same fire-time guard as a user's own answer applies, and it is not
   * optional: herdr reports claude's first-run trust dialog as `idle`, and `esc`
   * there means "No, exit" — a timer landing on a mis-read state would kill the
   * user's claude (probe 2026-08-02).
   */
  async function denyUnattended(requestId: string): Promise<void> {
    const sessionId = bySessionOfRequest.get(requestId);
    if (!sessionId) return;
    const entry = pending.get(sessionId);
    if (!entry || entry.requestId !== requestId) return;

    if (!(await guardStillCurrent(entry))) {
      drop(sessionId);
      return;
    }
    try {
      await client.paneSendKeys(sessionId, ["esc"]);
      await reportKeys(sessionId, "auto_deny", "sent");
    } catch (error) {
      await reportKeys(sessionId, "auto_deny", "failed");
      warn(`${sessionId}: unattended deny failed: ${describe(error)}`);
    }
    drop(sessionId);
  }

  /**
   * One status observation for a pane, from the global `pane.updated` stream.
   *
   * Leaving `blocked` drops the pending record without a keystroke: whoever
   * answered — the human at the terminal, or the phone — has already been heard.
   */
  async function onStatus(sessionId: string, status: string, kind?: string): Promise<void> {
    if (status !== "blocked") {
      drop(sessionId);
      return;
    }

    const sample = await readPrompt(sessionId);
    if (!sample) return;

    const fingerprint = sample.parsed?.fingerprint ?? UNPARSED_FINGERPRINT;
    // Same question, seen twice: the phone already has it.
    if (pending.get(sessionId)?.fingerprint === fingerprint) return;

    // H1: only omp drops the unanswerable card. claude and an absent kind keep
    // Cancel-only so the phone still has a way off that screen.
    if (!sample.parsed && kind === "omp") {
      drop(sessionId);
      try {
        Promise.resolve(onUnparsedBlockedScreen(sessionId, sample.text)).catch((error: unknown) => {
          warn(`onUnparsedBlockedScreen rejected for ${sessionId}: ${describe(error)}`);
        });
      } catch (error) {
        warn(`onUnparsedBlockedScreen threw for ${sessionId}: ${describe(error)}`);
      }
      return;
    }

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

    // Checked before the guard read so an option this prompt does not offer is
    // refused without an RPC — the guard's job is freshness, not validation.
    if (!offeredOption(entry, answer)) {
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

    // Derived from the guard's own read, never from the emit-time snapshot: on
    // omp the answer is a distance to travel, and a human at the terminal may
    // have moved the cursor since the phone was shown this prompt.
    const keys = keysFor(entry, answer, guard.parsed);
    if (!keys) {
      drop(sessionId);
      sendError(
        sessionId,
        "permission_prompt_stale",
        "The terminal's selection could not be read; nothing was sent.",
      );
      return true;
    }

    try {
      await client.paneSendKeys(sessionId, keys);
      await reportKeys(sessionId, "permission_answer", "sent");
    } catch (error) {
      await reportKeys(sessionId, "permission_answer", "failed");
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

  /** Which of this prompt's options the answer names; `undefined` for none. */
  function chosenIndex(
    entry: PendingNativePermission,
    answer: { optionId?: string; allow?: boolean },
  ): number | undefined {
    if (answer.optionId !== undefined) {
      const index = entry.options.findIndex((option) => option.id === answer.optionId);
      return index === -1 ? undefined : index;
    }
    // The legacy `{allow}` form, mapped conservatively (Decision M14): an
    // approval becomes the terminal's FIRST option — the one-shot "Yes" — so an
    // old client's "allow for this session" approves once rather than granting
    // a standing permission nobody re-confirmed. A denial is `esc` and needs no
    // option at all.
    if (answer.allow === true) return entry.options.length > 0 ? 0 : undefined;
    return undefined;
  }

  /** Whether this answer names something this prompt actually offers. */
  function offeredOption(
    entry: PendingNativePermission,
    answer: { optionId?: string; allow?: boolean },
  ): boolean {
    if (answer.allow === false) return true;
    return chosenIndex(entry, answer) !== undefined;
  }

  /**
   * The keys that answer this request, read against the screen as it is NOW.
   *
   * `esc` stays the one automated answer and needs no option: it is what a
   * denial means on both terminals, and what omp itself labels the key
   * (`esc cancel`, spike 2026-08-06 — after which omp wrote a
   * `Tool call denied by user` result and carried the turn on).
   *
   * `undefined` means "cannot be determined safely" and blocks the send. That
   * happens on omp when the current selection could not be read: Enter would
   * then choose whatever the cursor happens to sit on, which on a two-option
   * Approve/Deny prompt is a coin flip between allowing and refusing a tool.
   */
  function keysFor(
    entry: PendingNativePermission,
    answer: { optionId?: string; allow?: boolean },
    fresh: ParsedPrompt | null,
  ): string[] | undefined {
    if (answer.optionId === undefined && answer.allow === false) return ["esc"];

    const index = chosenIndex(entry, answer);
    if (index === undefined) return undefined;

    if (entry.dialect === "omp") {
      return ompAnswerKeys(index, fresh?.selectedIndex);
    }
    const keystroke = entry.options[index]?.keystroke;
    return keystroke ? [keystroke] : undefined;
  }

  /**
   * The fire-time guard: two fresh reads, never the remembered state.
   *
   * `agent_status` proves *a* prompt is up; the fingerprint proves it is *the*
   * prompt the user answered. Without the second check, a human answering at the
   * terminal between emit and tap would let "press 2" approve something the user
   * on the phone never saw. Any RPC failure counts as "cannot prove it is
   * current" and blocks the keystroke.
   *
   * Returns the fresh parse (rather than just "yes") because the answer itself
   * is computed from it: an omp keystroke is a distance from wherever the
   * terminal's cursor is at this moment. `null` on an unparseable screen whose
   * fingerprint nonetheless matches — that pairing only answers with `esc`,
   * which needs nothing read.
   */
  async function guardStillCurrent(
    entry: PendingNativePermission,
  ): Promise<{ ok: true; parsed: ParsedPrompt | null } | undefined> {
    try {
      const agent = await client.agentGet(entry.sessionId);
      if (agent.agent_status !== "blocked") return undefined;
    } catch (error) {
      warn(`${entry.sessionId}: agent.get failed, refusing to send keys: ${describe(error)}`);
      return undefined;
    }

    const sample = await readPrompt(entry.sessionId);
    if (!sample) return undefined;
    if ((sample.parsed?.fingerprint ?? UNPARSED_FINGERPRINT) !== entry.fingerprint)
      return undefined;
    return { ok: true, parsed: sample.parsed };
  }

  /**
   * Connection lost: freeze the countdown, keep the pending records.
   *
   * The gap does not count against the user — they cannot answer a prompt they
   * cannot see. What was already spent is remembered, so a long disconnect does
   * not silently reset the budget either.
   */
  function pause(): void {
    if (paused) return;
    paused = true;
    for (const entry of pending.values()) {
      if (entry.timerId === undefined) continue;
      clearTimeoutFn(entry.timerId);
      entry.timerId = undefined;
      entry.elapsedMs += now() - (entry.armedAt ?? now());
      entry.armedAt = undefined;
    }
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
      const spent = entry.elapsedMs;
      drop(entry.sessionId);
      emit(entry.sessionId, sample, entry.origin, spent);
    }
  }

  /** Session gone: nothing left to answer. */
  function forget(sessionId: string): void {
    drop(sessionId);
  }

  function sessionOfRequest(requestId: string): string | undefined {
    return bySessionOfRequest.get(requestId);
  }

  function pendingFor(sessionId: string): PendingNativePermission | undefined {
    return pending.get(sessionId);
  }

  function pendingCount(): number {
    return pending.size;
  }

  return {
    onStatus,
    resolve,
    pause,
    resume,
    forget,
    sessionOfRequest,
    pendingFor,
    pendingCount,
  };
}

export type NativePermission = ReturnType<typeof createNativePermission>;
