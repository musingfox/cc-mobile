import { HerdrRpcError, HerdrTransportError } from "./errors";
import {
  ErrorEnvelopeSchema,
  type EventEnvelope,
  EventEnvelopeSchema,
  ResultEnvelopeSchema,
  type SessionSnapshot,
  SubscriptionStartedResultSchema,
} from "./schema";
import {
  type ClearTimeoutFn,
  createLineSplitter,
  type HerdrConnect,
  type HerdrConnection,
  type TimerHandle,
} from "./transport";

// ---------------------------------------------------------------------------
// events.subscribe stream — the one long-lived exception to herdr's
// one-request-per-connection rule: the daemon acks with
// `{"id", "result": {"type": "subscription_started"}}` then streams
// `{event, data}` lines until disconnect.
// ---------------------------------------------------------------------------

/** One daemon-side subscription filter, forwarded verbatim (wire snake_case). */
export interface SubscriptionSpec {
  type: string;
  [key: string]: unknown;
}

export interface SubscribeEventsOptions {
  subscriptions: SubscriptionSpec[];
  /** Called for every parsed event line, in arrival order. */
  onEvent: (event: EventEnvelope) => void;
  /** Called with a fresh session snapshot after every successful re-subscribe. */
  onResync?: (snapshot: SessionSnapshot) => void;
  /** Non-fatal problems: malformed event lines, reconnect failures. */
  onError?: (error: Error) => void;
}

export interface SubscriptionHandle {
  /** Closes the connection and disables any further delivery/reconnect. */
  stop(): void;
}

export interface SubscribeDeps {
  connect: HerdrConnect;
  /** Fresh session.snapshot fetcher used to re-align consumer state on reconnect. */
  fetchSnapshot: () => Promise<SessionSnapshot>;
  setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeoutFn?: ClearTimeoutFn;
}

/**
 * Opens a long-lived events.subscribe stream. Resolves with a handle after
 * the daemon confirms the subscription; rejects with HerdrRpcError when the
 * daemon replies an error line instead of the ack.
 */
export async function subscribeEvents(
  options: SubscribeEventsOptions,
  deps: SubscribeDeps,
): Promise<SubscriptionHandle> {
  const clearTimeoutFn: ClearTimeoutFn =
    deps.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let stopped = false;
  let connection: HerdrConnection | undefined;
  let pendingTimer: TimerHandle | undefined;
  let subscriptionSeq = 0;

  /** Opens one connection, writes the subscribe request, resolves on ack. */
  function openOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let acked = false;
      let settled = false;
      const splitLines = createLineSplitter();
      let conn: HerdrConnection | undefined;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
        conn?.end();
      };

      const handleAckLine = (line: string) => {
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch (error) {
          fail(
            new HerdrTransportError("herdr events.subscribe: unparseable ack line", {
              cause: error,
            }),
          );
          return;
        }
        const errorEnvelope = ErrorEnvelopeSchema.safeParse(raw);
        if (errorEnvelope.success) {
          fail(new HerdrRpcError(errorEnvelope.data.error.code, errorEnvelope.data.error.message));
          return;
        }
        const resultEnvelope = ResultEnvelopeSchema.safeParse(raw);
        if (
          resultEnvelope.success &&
          SubscriptionStartedResultSchema.safeParse(resultEnvelope.data.result).success
        ) {
          acked = true;
          settled = true;
          resolve();
          return;
        }
        fail(new HerdrTransportError("herdr events.subscribe: unexpected ack payload"));
      };

      const handleEventLine = (line: string) => {
        try {
          options.onEvent(EventEnvelopeSchema.parse(JSON.parse(line)));
        } catch (error) {
          options.onError?.(
            new HerdrTransportError("herdr events.subscribe: malformed event line", {
              cause: error,
            }),
          );
        }
      };

      (async () => {
        conn = await deps.connect({
          onData(chunk) {
            for (const line of splitLines(chunk)) {
              if (stopped) return;
              if (line.trim().length === 0) continue;
              if (acked) handleEventLine(line);
              else handleAckLine(line);
            }
          },
          onClose() {
            if (stopped) return;
            if (!acked) {
              fail(new HerdrTransportError("herdr events.subscribe: connection closed before ack"));
              return;
            }
            onUnexpectedClose();
          },
          onError(error) {
            if (stopped) return;
            if (!acked) {
              fail(
                new HerdrTransportError(`herdr events.subscribe: socket error: ${error.message}`, {
                  cause: error,
                }),
              );
              return;
            }
            options.onError?.(error);
          },
        });
        connection = conn;
        subscriptionSeq += 1;
        conn.write(
          `${JSON.stringify({
            id: `sub-${subscriptionSeq}`,
            method: "events.subscribe",
            params: { subscriptions: options.subscriptions },
          })}\n`,
        );
      })().catch((error: unknown) => {
        fail(
          new HerdrTransportError(
            `herdr events.subscribe: connect failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { cause: error },
          ),
        );
      });
    });
  }

  /** Unexpected connection loss after ack; reconnect lands with SubscriptionReconnect. */
  function onUnexpectedClose(): void {
    if (stopped) return;
    options.onError?.(new HerdrTransportError("herdr events.subscribe: connection lost"));
  }

  await openOnce();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (pendingTimer !== undefined) {
        clearTimeoutFn(pendingTimer);
        pendingTimer = undefined;
      }
      connection?.end();
    },
  };
}
