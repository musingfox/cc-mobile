/**
 * phone-driven.ts — which panes the phone spoke into most recently.
 *
 * The push scope rule (`phone-last`) is "notify me about the work I asked for
 * from my phone". That cannot be read off a pane: herdr reports what a pane is
 * doing, never who told it to. So it is inferred from the one thing this server
 * does know — that *it* injected a prompt — plus the turns it sees start
 * without having done so.
 *
 * Three hooks, because two are not enough:
 *
 * - `markSent`      cc-mobile injected a prompt (the only way it can).
 * - `onTurnStart`   a pane began working. Whether an unspent send is sitting
 *                   there is what separates "the phone asked for this" from
 *                   "someone typed at the keyboard".
 * - `onTurnSettled` that turn is over, so its send token is spent.
 *
 * The third hook is the non-obvious one. claude accepts input while it is
 * already working, and a send in that window produces no idle→working
 * transition to consume the token. Without clearing it at settle the token
 * survives into the *next* turn and would credit the phone for something typed
 * at the terminal.
 *
 * State is in memory and per-process: after a restart no pane is phone-driven
 * until the phone speaks again. That fails quiet rather than loud, which is the
 * right direction for something that vibrates a pocket.
 */

export interface PhoneDrivenTracker {
  /** cc-mobile injected a prompt into this pane. */
  markSent(paneId: string): void;
  /** This pane began working. */
  onTurnStart(paneId: string): void;
  /** This pane's turn ended. */
  onTurnSettled(paneId: string): void;
  /** Whether the phone is behind this pane's current or most recent turn. */
  isPhoneDriven(paneId: string): boolean;
  /** The pane is gone; drop it rather than leaking a row per closed session. */
  forget(paneId: string): void;
}

export function createPhoneDrivenTracker(): PhoneDrivenTracker {
  /** Sends not yet accounted for by a turn. At most one per pane matters. */
  const unspent = new Set<string>();
  /** The verdict a trigger reads. */
  const driven = new Set<string>();

  return {
    markSent(paneId) {
      // Optimistic on purpose: the phone just spoke, so it owns this pane until
      // something else visibly takes over. It covers the queued-input case,
      // where no transition will ever arrive to set this.
      unspent.add(paneId);
      driven.add(paneId);
    },

    onTurnStart(paneId) {
      // The delete is the test: a token here means this turn is the one the
      // phone asked for. No token means the input came from somewhere this
      // server cannot see — the terminal itself.
      if (unspent.delete(paneId)) driven.add(paneId);
      else driven.delete(paneId);
    },

    onTurnSettled(paneId) {
      // Spend it whether or not a transition consumed it, so it cannot be
      // read again by a turn it has nothing to do with.
      unspent.delete(paneId);
    },

    isPhoneDriven(paneId) {
      return driven.has(paneId);
    },

    forget(paneId) {
      unspent.delete(paneId);
      driven.delete(paneId);
    },
  };
}
