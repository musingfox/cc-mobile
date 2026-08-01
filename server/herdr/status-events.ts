/**
 * status-events.ts — HerdrStatusForwarding: live claude activity state → the
 * mobile UI's existing `session_state` message.
 *
 * Auxiliary only (plan D6). These events can never carry the reply: the
 * subscription stream has no gap replay across reconnects, and `done` lags the
 * Stop-hook POST by ~10s (live probe). Reply text stays exclusively on the
 * response relay; this is just the spinner/blocked indicator.
 *
 * One subscription per session, because the daemon rejects a type-only filter
 * on `pane.agent_status_changed` — `pane_id` is required.
 */

import type { SubscribeEventsOptions, SubscriptionHandle } from "./subscribe";

export type ClientSink = (msg: Record<string, unknown>) => void;

/** herdr agent_status → the client's session_state enum; `unknown` is dropped. */
const STATE_BY_AGENT_STATUS: Record<string, "idle" | "running" | "requires_action" | undefined> = {
  working: "running",
  blocked: "requires_action",
  idle: "idle",
  // End-of-turn is `done`, not `idle` — both mean "not busy" to the UI.
  done: "idle",
};

export interface HerdrStatusEventsOptions {
  subscribe: (options: SubscribeEventsOptions) => Promise<SubscriptionHandle>;
  /** Late-bound sink lookup, so a reconnect that rebinds the uuid still gets events. */
  getSink: (claudeUuid: string) => ClientSink | undefined;
  onError?: (error: Error) => void;
}

export function createHerdrStatusEvents(options: HerdrStatusEventsOptions) {
  const { subscribe, getSink } = options;
  const onError =
    options.onError ??
    ((error: Error) => {
      console.warn(`[herdr] status subscription: ${error.message}`);
    });

  const handles = new Map<string, SubscriptionHandle>();
  /** uuids that still want a subscription — guards a stop() racing an in-flight start. */
  const wanted = new Set<string>();

  // `data` is optional: the event schema types it as z.unknown().
  function forward(claudeUuid: string, event: { data?: unknown }): void {
    const data = event.data as { agent_status?: unknown } | null;
    const status = typeof data?.agent_status === "string" ? data.agent_status : undefined;
    const state = status ? STATE_BY_AGENT_STATUS[status] : undefined;
    if (!state) return;

    getSink(claudeUuid)?.({ type: "session_state", sessionId: claudeUuid, state });
  }

  /**
   * Subscribes to one pane's status changes. Never rejects: a failed
   * subscription costs the UI its activity indicator, not its session.
   */
  async function start(claudeUuid: string, paneId: string): Promise<void> {
    wanted.add(claudeUuid);
    try {
      const handle = await subscribe({
        subscriptions: [{ type: "pane.agent_status_changed", pane_id: paneId }],
        onEvent: (event) => forward(claudeUuid, event),
        onError,
      });
      if (!wanted.has(claudeUuid)) {
        // Torn down while the subscription was still opening.
        handle.stop();
        return;
      }
      handles.set(claudeUuid, handle);
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function stop(claudeUuid: string): void {
    wanted.delete(claudeUuid);
    handles.get(claudeUuid)?.stop();
    handles.delete(claudeUuid);
  }

  function stopAll(): void {
    for (const claudeUuid of [...handles.keys()]) stop(claudeUuid);
    wanted.clear();
  }

  return { start, stop, stopAll };
}

export type HerdrStatusEvents = ReturnType<typeof createHerdrStatusEvents>;
