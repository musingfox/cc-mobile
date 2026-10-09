/**
 * send-routing.ts — HerdrPromptInjection + the client sink map.
 *
 * `pane.send_text` lands multi-line text in the composer without submitting,
 * then `pane.send_keys ["Enter"]` submits the whole thing as one turn
 * (live-verified 2026-08-01). No prompt flattening.
 *
 * This module no longer waits for a reply. Since #29 the answer comes from
 * claude's own transcript file (`server/transcript/`), driven by the status
 * transition herdr reports — so a session the user started in their own
 * terminal reads back exactly like one cc-mobile launched, which a Stop hook
 * cc-mobile installs never could. What survives is the sink map, including its
 * late-bound lookup: a reconnect rebinds a session to a fresh sink and the
 * delivery module consults it at delivery time (E1/E3).
 *
 * `agent.wait` is deliberately never called: it matches the CURRENT settled
 * state, so waiting after a second Enter resolves instantly on the previous
 * turn's `done`.
 */

import type { TerminalSendOutcome } from "../terminal-backend";
import { bottomComposerOpensWith, composerHasTypedText } from "./prompt-box";

export type ClientSink = (msg: Record<string, unknown>) => void;

/** The pane-injection slice of the herdr client. */
export interface HerdrSendClient {
  paneSendText(paneId: string, text: string): Promise<void>;
  paneSendKeys(paneId: string, keys: string[]): Promise<void>;
  /** Readiness probe: what is this pane's claude doing right now? */
  agentGet(target: string): Promise<{ agent_status?: string }>;
  /** Readiness probe: what is on its screen right now? */
  paneRead(params: {
    pane_id: string;
    source: "detection" | "recent";
    lines?: number;
  }): Promise<{ text: string }>;
}

export interface HerdrSendRoutingOptions {
  client: HerdrSendClient;
  /** claudeUuid → herdr pane id; the registry owns the mapping. */
  resolvePane: (claudeUuid: string) => string | undefined;
  /**
   * Pane ids the daemon reports as drivable. The fallback for a session key
   * that IS a pane id — every session the user opened in their own terminal,
   * which this process's registry has never heard of (Decision H1/H5).
   */
  listDrivablePanes?: () => Promise<string[]>;
  /**
   * Runs with the target pane once readiness has passed and before anything is
   * typed. A rejection is swallowed: whatever it prepares, the prompt still goes.
   */
  beforeInject?: (paneId: string) => Promise<void>;
  /** Delay between `agent_status` samples while confirming a start (default 250ms). */
  startPollMs?: number;
  /** How long each Enter is given to show a start, by the clock (default 5s). */
  startWindowMs?: number;
}

/** Statuses in which claude is waiting for input rather than doing something. */
const READY_STATUSES = new Set(["idle", "done"]);

const DEFAULT_START_POLL_MS = 250;
/** herdr's own stall window for `agent.prompt`. */
const DEFAULT_START_WINDOW_MS = 5_000;
/** A swallowed Enter takes two more to send: one strips it, the next submits. */
const START_ENTER_RETRIES = 2;
/** The cap on the screen read and on each extra Enter, so the total stays bounded. */
const START_IO_TIMEOUT_MS = 1_000;
/**
 * Rows read when looking for the unsent prompt. A card fills a composer taller
 * than the 40-row screen, so the box's top rule is only in the scrollback: the
 * detection read found no box at all (live 2026-10-09), `recent` found it.
 */
const COMPOSER_READ_LINES = 400;

/** `work`, or a rejection once `ms` has passed; the timer never outlives it. */
async function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface HerdrSendParams {
  claudeUuid: string;
  content: string;
  confirmStart?: boolean;
}

export function createHerdrSendRouting(options: HerdrSendRoutingOptions) {
  const { client, resolvePane } = options;
  const listDrivablePanes = options.listDrivablePanes ?? (async () => []);
  const beforeInject = options.beforeInject ?? (async () => {});
  const startPollMs = options.startPollMs ?? DEFAULT_START_POLL_MS;
  const startWindowMs = options.startWindowMs ?? DEFAULT_START_WINDOW_MS;

  const clientSinks = new Map<string, ClientSink>();
  const ownerToUuids = new Map<unknown, Set<string>>();
  const uuidToOwner = new Map<string, unknown>();
  /** Sinks bound with no connection behind them; see `hasClients`. */
  const ownerlessSinks = new Set<string>();

  function registerClient(claudeUuid: string, sink: ClientSink, owner?: unknown) {
    if (owner === undefined) ownerlessSinks.add(claudeUuid);
    else ownerlessSinks.delete(claudeUuid);
    clientSinks.set(claudeUuid, sink);
    const prevOwner = uuidToOwner.get(claudeUuid);
    if (prevOwner !== undefined && prevOwner !== owner) {
      ownerToUuids.get(prevOwner)?.delete(claudeUuid);
    }
    if (owner !== undefined) {
      uuidToOwner.set(claudeUuid, owner);
      let set = ownerToUuids.get(owner);
      if (!set) {
        set = new Set();
        ownerToUuids.set(owner, set);
      }
      set.add(claudeUuid);
    } else {
      uuidToOwner.delete(claudeUuid);
    }
  }

  /**
   * The pane this session key addresses.
   *
   * A key this process launched resolves through the registry. Any other key is
   * treated as a pane id and checked against the daemon's own drivable list,
   * which is what lets the phone continue a session the user started in their
   * own terminal — the registry has no entry for one and never will.
   */
  async function resolveTarget(sessionKey: string): Promise<string | undefined> {
    const own = resolvePane(sessionKey);
    if (own !== undefined) return own;
    try {
      return (await listDrivablePanes()).includes(sessionKey) ? sessionKey : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Whether a prompt may be typed into this pane right now.
   *
   * Two refusals only: claude is mid-turn, or a human has half-typed something
   * in the composer. The pane's permission mode is deliberately NOT consulted —
   * an ungated pane is driven exactly like any other, flagged rather than
   * blocked, by the owner's own ruling (Decision H4).
   *
   * A probe that cannot be completed does not refuse: a daemon hiccup must not
   * silently swallow the user's prompt, and the injection itself reports its own
   * failure.
   */
  async function isReady(paneId: string): Promise<{ ready: boolean; status?: string }> {
    let status: string | undefined;
    try {
      const reported = (await client.agentGet(paneId)).agent_status;
      if (typeof reported === "string") status = reported;
      if (status !== undefined && !READY_STATUSES.has(status)) return { ready: false, status };
    } catch {
      return { ready: true };
    }
    try {
      const read = await client.paneRead({ pane_id: paneId, source: "detection" });
      return { ready: !composerHasTypedText(read.text), status };
    } catch {
      return { ready: true, status };
    }
  }

  /**
   * Whether claude took the Enter as a submit, pressing it again when not.
   *
   * `pane.send_text` is not a bracketed paste, so a claude too busy to read
   * between the two writes gets the Enter in the same burst as the text. It
   * keeps the Enter as part of the paste, and the text then sits in the
   * composer. The next Enter only strips it ("Removed 1 invisible character ·
   * review and press Enter to send"); the one after that sends. Probe
   * 2026-10-09: 6 of 8 claudes started four at a time took no turn, 0 of 2
   * started one at a time; the same text with `\r` appended reproduces it.
   *
   * Started is any move away from the status the pane had before the prompt,
   * `unknown` aside: a turn can run and settle to `done` between two samples.
   * An extra Enter is pressed only on evidence that nothing started: every
   * sample of the window answered, and answered that same status, and the
   * bottom of the screen is claude's composer opening with this prompt's first
   * line. A failed, `unknown` or missing sample, an unknown starting status, or
   * any other screen (a question, permission, trust or menu dialog, whose
   * highlighted option an Enter would pick) presses nothing and fails. A start
   * seen later in the same window still counts.
   *
   * Each window is measured by the clock, and every call in it is cut off at
   * its deadline, so a slow daemon cannot stretch the wait.
   */
  async function confirmStarted(
    paneId: string,
    before: string | undefined,
    content: string,
  ): Promise<boolean> {
    const baseline = before ?? "idle";
    for (let enter = 0; ; enter += 1) {
      const deadline = Date.now() + startWindowMs;
      let unchanged = before !== undefined;
      let answered = 0;
      for (;;) {
        const left = deadline - Date.now();
        if (left <= 0) break;
        let status: unknown;
        try {
          status = (await within(left, client.agentGet(paneId))).agent_status;
        } catch {
          // Cut off by the window's own end: that is the window closing, not a failure.
          if (Date.now() >= deadline) break;
          status = undefined;
        }
        if (typeof status !== "string" || status === "unknown") unchanged = false;
        else if (status !== baseline) return true;
        else answered += 1;
        const pause = Math.min(startPollMs, deadline - Date.now());
        if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
      }
      if (!unchanged || answered === 0 || enter === START_ENTER_RETRIES) return false;
      let screen: string;
      try {
        const read = client.paneRead({
          pane_id: paneId,
          source: "recent",
          lines: COMPOSER_READ_LINES,
        });
        screen = (await within(START_IO_TIMEOUT_MS, read)).text;
      } catch {
        return false;
      }
      if (!bottomComposerOpensWith(screen, content.split("\n")[0] ?? "")) return false;
      await within(START_IO_TIMEOUT_MS, client.paneSendKeys(paneId, ["Enter"]));
    }
  }

  async function send(params: HerdrSendParams): Promise<TerminalSendOutcome> {
    const { claudeUuid, content } = params;
    if (!clientSinks.has(claudeUuid)) {
      // Unregistered: no RPC, no waiter (the port's send never throws).
      return { ok: false, code: "terminal_send_failed" };
    }

    const paneId = await resolveTarget(claudeUuid);

    // Readiness is decided BEFORE the waiter is armed: a refusal must leave no
    // trace at all — no injection, no pending turn, nothing for the UI to spin
    // on.
    const readiness = paneId === undefined ? undefined : await isReady(paneId);
    if (readiness !== undefined && !readiness.ready) {
      clientSinks.get(claudeUuid)?.({
        type: "error",
        sessionId: claudeUuid,
        code: "session_busy",
        message:
          "That session is busy — it is mid-turn or someone has started typing in the terminal. Nothing was sent.",
      });
      return { ok: false, code: "session_busy" };
    }

    if (paneId !== undefined) await beforeInject(paneId).catch(() => {});

    try {
      if (paneId === undefined) {
        throw new Error("no pane mapping");
      }
      // Verbatim: newlines land in the composer, Enter submits one turn.
      await client.paneSendText(paneId, content);
      await client.paneSendKeys(paneId, ["Enter"]);
      if (params.confirmStart && !(await confirmStarted(paneId, readiness?.status, content))) {
        clientSinks.get(claudeUuid)?.({
          type: "error",
          sessionId: claudeUuid,
          code: "prompt_not_started",
          message:
            "The prompt was typed but the agent was never seen starting the turn; it may still be sitting in the composer.",
        });
        return { ok: false, code: "prompt_not_started" };
      }
      return { ok: true };
    } catch (error) {
      // The pane is gone or unreachable: say so rather than leaving the phone
      // waiting for a turn that was never started.
      const failSink = clientSinks.get(claudeUuid);
      failSink?.({
        type: "error",
        sessionId: claudeUuid,
        code: "terminal_send_failed",
        message: `Terminal session ${claudeUuid} is not reachable (${
          error instanceof Error ? error.message : String(error)
        }). The paired terminal session may have closed.`,
      });
      return { ok: false, code: "terminal_send_failed" };
    }
  }

  /** Terminal removal: drop the sink and the owner index for this session. */
  function teardown(claudeUuid: string): void {
    clientSinks.delete(claudeUuid);
    ownerlessSinks.delete(claudeUuid);
    const owner = uuidToOwner.get(claudeUuid);
    if (owner !== undefined) {
      ownerToUuids.get(owner)?.delete(claudeUuid);
      uuidToOwner.delete(claudeUuid);
    }
  }

  /**
   * Transient disconnect (ws close): release the owner index for that
   * connection. The sink stays installed, so a reply or a permission_request
   * landing during the gap still reaches the buffer-first sink and replays on
   * reconnect (E2). Only the owner index is per-connection
   * and therefore unbounded — `clientSinks` is uuid-keyed and last-write-wins,
   * so a reconnect displaces the stale entry and teardown removes it for good.
   */
  function cleanupByOwner(owner: unknown): void {
    const uuids = ownerToUuids.get(owner);
    if (!uuids) return;
    for (const claudeUuid of uuids) {
      uuidToOwner.delete(claudeUuid);
    }
    ownerToUuids.delete(owner);
  }

  function getClient(claudeUuid: string): ClientSink | undefined {
    return clientSinks.get(claudeUuid);
  }

  /**
   * Whether any live connection is still listening.
   *
   * Ownership, not the sink map, is the signal: a sink outlives its connection
   * on purpose (it buffers for the reconnect), while `cleanupByOwner` runs the
   * moment a socket closes. A registration made with no owner — only tests do
   * that — counts as a listener, so injecting one never silences anything.
   */
  function hasClients(): boolean {
    return ownerToUuids.size > 0 || ownerlessSinks.size > 0;
  }

  return {
    registerClient,
    hasClients,
    send,
    teardown,
    cleanupByOwner,
    getClient,
  };
}

export type HerdrSendRouting = ReturnType<typeof createHerdrSendRouting>;
