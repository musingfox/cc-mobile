/**
 * The sentence a toast shows for a server error that names no session.
 *
 * Most codes already arrive with a message written for a person (a bad path, an
 * unknown profile) and pass through. Two do not: `terminal_error` carries
 * whatever herdr or its socket said, verbatim — `agent_pane_busy: agent target
 * pane wJ4:p1 is not an available shell` reached a phone as-is — and
 * `invalid_message` is the Zod gate's own wording. The raw frame is not lost:
 * the caller logs it, and the `?debug=1` overlay records every frame received.
 */

/** herdr's error envelope arrives as `<code>: <message>` (HerdrRpcError). */
const HERDR_CODE = /^([a-z][a-z0-9_]*): /;

/** A failure of the unix socket itself, not an answer from herdr (HerdrTransportError). */
const HERDR_UNREACHABLE = /^herdr [a-z_]+\.[a-z_.]+: /;

const START_FAILURE: Record<string, string> = {
  agent_pane_busy: "Couldn't start the session: the new terminal wasn't ready yet. Try again.",
  unsupported_agent_kind: "Couldn't start the session: this herdr can't launch that agent.",
};

export function describeServerError(code: string, message: string, creating: boolean): string {
  if (code === "terminal_error") {
    if (HERDR_UNREACHABLE.test(message)) return "cc-mobile can't reach herdr on the host.";
    const herdrCode = HERDR_CODE.exec(message)?.[1];
    if (creating) {
      return (herdrCode && START_FAILURE[herdrCode]) || "Couldn't start the session. Try again.";
    }
    return "Couldn't close the session.";
  }
  if (code === "invalid_message") {
    return "The server didn't accept that request. Reload the app and try again.";
  }
  return message || code;
}
