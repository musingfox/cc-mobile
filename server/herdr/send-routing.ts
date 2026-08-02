/**
 * send-routing.ts — HerdrPromptInjection + HerdrReplyDelivery.
 *
 * The waiter/sink semantics (arm before injecting, arm-time sink capture for
 * E1/E3 recovery, cancel-on-failure) were carried over 1:1 from the previous
 * terminal adapter, which is gone as of #25. Only the injection differs, and
 * that difference is the point of #22: `pane.send_text` lands multi-line text
 * in the composer without submitting, then `pane.send_keys ["Enter"]` submits
 * the whole thing as one turn (live-verified 2026-08-01). No prompt flattening.
 *
 * `agent.wait` is deliberately never called: it matches the CURRENT settled
 * state, so waiting after a second Enter resolves instantly on the previous
 * turn's `done`. The Stop-hook relay is the only reply signal.
 */

import type { createPtyResponseRelay } from "../pty-response-relay";

export type ClientSink = (msg: Record<string, unknown>) => void;

/** The pane-injection slice of the herdr client. */
export interface HerdrSendClient {
  paneSendText(paneId: string, text: string): Promise<void>;
  paneSendKeys(paneId: string, keys: string[]): Promise<void>;
}

export interface HerdrSendRoutingOptions {
  client: HerdrSendClient;
  /** claudeUuid → herdr pane id; the registry owns the mapping. */
  resolvePane: (claudeUuid: string) => string | undefined;
  responseRelay: ReturnType<typeof createPtyResponseRelay>;
}

export interface HerdrSendParams {
  claudeUuid: string;
  content: string;
}

export function createHerdrSendRouting(options: HerdrSendRoutingOptions) {
  const { client, resolvePane, responseRelay: relay } = options;

  const clientSinks = new Map<string, ClientSink>();
  const ownerToUuids = new Map<unknown, Set<string>>();
  const uuidToOwner = new Map<string, unknown>();

  function registerClient(claudeUuid: string, sink: ClientSink, owner?: unknown) {
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

  async function send(params: HerdrSendParams): Promise<void> {
    const { claudeUuid, content } = params;
    if (!clientSinks.has(claudeUuid)) {
      // Unregistered: no RPC, no waiter (the port's send never throws).
      return;
    }

    // Captured before arming: if the owner disconnects mid-turn, cleanupByOwner
    // drops this uuid from clientSinks but the buffer-first sink referenced here
    // still appends the reply to the event buffer for replay on reconnect (E1).
    const armTimeSink = clientSinks.get(claudeUuid);

    // Armed before injection so the Stop-hook POST can never beat the waiter.
    const responsePromise = relay.awaitResponse(claudeUuid);

    try {
      const paneId = resolvePane(claudeUuid);
      if (paneId === undefined) {
        throw new Error("no pane mapping");
      }
      // Verbatim: newlines land in the composer, Enter submits one turn.
      await client.paneSendText(paneId, content);
      await client.paneSendKeys(paneId, ["Enter"]);
    } catch (error) {
      // The pane is gone or unreachable, so the Stop hook will never fire and
      // the armed waiter would spin the client UI forever.
      responsePromise.catch(() => {});
      relay.cancel(claudeUuid);
      const failSink = clientSinks.get(claudeUuid);
      failSink?.({
        type: "error",
        sessionId: claudeUuid,
        code: "terminal_send_failed",
        message: `Terminal session ${claudeUuid} is not reachable (${
          error instanceof Error ? error.message : String(error)
        }). The paired terminal session may have closed.`,
      });
      return;
    }

    responsePromise
      .then((text: string) => {
        // E3 first: a reconnect may have rebound this uuid to a new sink.
        // E1 fallback: deliver into the arm-time sink so a reply arriving while
        // fully disconnected still reaches the event buffer.
        const currentSink = clientSinks.get(claudeUuid) ?? armTimeSink;
        if (currentSink) {
          currentSink({
            type: "stream_chunk",
            sessionId: claudeUuid,
            chunk: {
              type: "assistant",
              message: {
                role: "assistant",
                content: [{ type: "text", text }],
                stop_reason: "end_turn",
              },
            },
          });
          currentSink({ type: "stream_end", sessionId: claudeUuid });
        }
      })
      .catch(() => {
        // cancelled / timed out / superseded: no delivery
      });
  }

  function hasPending(claudeUuid: string): boolean {
    return relay.hasPending(claudeUuid);
  }

  /** Terminal removal: unlike cleanupByOwner, this DOES cancel the waiter. */
  function teardown(claudeUuid: string): void {
    clientSinks.delete(claudeUuid);
    relay.cancel(claudeUuid);
    const owner = uuidToOwner.get(claudeUuid);
    if (owner !== undefined) {
      ownerToUuids.get(owner)?.delete(claudeUuid);
      uuidToOwner.delete(claudeUuid);
    }
  }

  /**
   * Transient disconnect (ws close): release the owner index for that
   * connection. The waiter stays armed and the sink stays installed, so a reply
   * or a permission_request landing during the gap still reaches the buffer-first
   * sink and replays on reconnect (E2). Only the owner index is per-connection
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

  return {
    registerClient,
    send,
    hasPending,
    teardown,
    cleanupByOwner,
    getClient,
  };
}

export type HerdrSendRouting = ReturnType<typeof createHerdrSendRouting>;
