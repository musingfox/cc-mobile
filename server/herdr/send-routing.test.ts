/**
 * send-routing.test.ts — HerdrPromptInjection + HerdrReplyDelivery.
 *
 * Runs against a fake herdr client and the real response relay, so the
 * arm/resolve/cancel ordering under test is the production one. The E1/E3
 * disconnect cases are the reason the arm-time sink exists at all.
 */

import { describe, expect, test } from "bun:test";
import { createPtyResponseRelay } from "../pty-response-relay";
import { createHerdrSendRouting } from "./send-routing";

function makeHarness(
  panes: Record<string, string> = { u1: "p1" },
  clientOverrides: Partial<{
    paneSendText: (paneId: string, text: string) => Promise<void>;
    paneSendKeys: (paneId: string, keys: string[]) => Promise<void>;
  }> = {},
) {
  const order: string[] = [];
  let agentWaitCalls = 0;

  const client = {
    paneSendText: async (paneId: string, text: string) => {
      order.push(`paneSendText(${paneId},${JSON.stringify(text)})`);
      await clientOverrides.paneSendText?.(paneId, text);
    },
    paneSendKeys: async (paneId: string, keys: string[]) => {
      order.push(`paneSendKeys(${paneId},${JSON.stringify(keys)})`);
      await clientOverrides.paneSendKeys?.(paneId, keys);
    },
    // Present so the "never call agent.wait" constraint is actually observable.
    agentWait: async () => {
      agentWaitCalls += 1;
      return {};
    },
  };

  const real = createPtyResponseRelay();
  const relay = {
    awaitResponse: (sessionId: string) => {
      order.push(`awaitResponse(${sessionId})`);
      return real.awaitResponse(sessionId);
    },
    resolveResponse: (sessionId: string, text: string) => real.resolveResponse(sessionId, text),
    hasPending: (sessionId: string) => real.hasPending(sessionId),
    getPendingCount: () => real.getPendingCount(),
    cancel: (sessionId: string) => {
      order.push(`cancel(${sessionId})`);
      real.cancel(sessionId);
    },
  };

  const routing = createHerdrSendRouting({
    client,
    resolvePane: (claudeUuid) => panes[claudeUuid],
    responseRelay: relay,
  });

  return { routing, relay, order, client, agentWaitCalls: () => agentWaitCalls };
}

/** Lets the relay's then-callback microtasks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("HerdrPromptInjection", () => {
  test("arms the waiter, types the prompt verbatim, then submits with Enter", async () => {
    const harness = makeHarness();
    const seen: Record<string, unknown>[] = [];
    harness.routing.registerClient("u1", (msg) => seen.push(msg));

    await harness.routing.send({ claudeUuid: "u1", content: "line1\nline2" });

    expect(harness.order).toEqual([
      "awaitResponse(u1)",
      'paneSendText(p1,"line1\\nline2")',
      'paneSendKeys(p1,["Enter"])',
    ]);
    // The newline survives: no flattening on the herdr path.
    expect(harness.agentWaitCalls()).toBe(0);
    expect(seen).toEqual([]);
  });

  test("an unregistered uuid sends nothing and arms no waiter", async () => {
    const harness = makeHarness({ u2: "p2" });

    await harness.routing.send({ claudeUuid: "u2", content: "x" });

    expect(harness.order).toEqual([]);
    expect(harness.relay.hasPending("u2")).toBe(false);
  });

  test("a failed injection cancels the waiter and reports tmux_send_failed", async () => {
    const harness = makeHarness(
      { u1: "p1" },
      {
        paneSendText: async () => {
          throw new Error("pane is gone");
        },
      },
    );
    const seen: Record<string, unknown>[] = [];
    harness.routing.registerClient("u1", (msg) => seen.push(msg));

    await expect(harness.routing.send({ claudeUuid: "u1", content: "x" })).resolves.toBeUndefined();

    expect(harness.order).toContain("cancel(u1)");
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatchObject({
      type: "error",
      sessionId: "u1",
      code: "tmux_send_failed",
    });
    expect(String(seen[0]?.message)).toContain("not reachable");
    expect(harness.relay.hasPending("u1")).toBe(false);
    await flush();
  });

  test("a missing pane mapping fails the same way rather than hanging", async () => {
    const harness = makeHarness({});
    const seen: Record<string, unknown>[] = [];
    harness.routing.registerClient("u1", (msg) => seen.push(msg));

    await harness.routing.send({ claudeUuid: "u1", content: "x" });

    expect(seen[0]).toMatchObject({ code: "tmux_send_failed" });
    expect(harness.relay.hasPending("u1")).toBe(false);
    await flush();
  });
});

describe("HerdrReplyDelivery", () => {
  test("delivers the Stop-hook reply as an assistant chunk then stream_end", async () => {
    const harness = makeHarness();
    const seen: Record<string, unknown>[] = [];
    harness.routing.registerClient("u1", (msg) => seen.push(msg));
    await harness.routing.send({ claudeUuid: "u1", content: "hi" });

    harness.relay.resolveResponse("u1", "hello");
    await flush();

    expect(seen).toEqual([
      {
        type: "stream_chunk",
        sessionId: "u1",
        chunk: {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hello" }],
            stop_reason: "end_turn",
          },
        },
      },
      { type: "stream_end", sessionId: "u1" },
    ]);
  });

  test("E1: a reply arriving after the owner disconnected still reaches the arm-time sink", async () => {
    const harness = makeHarness();
    const seen: Record<string, unknown>[] = [];
    const owner = {};
    harness.routing.registerClient("u1", (msg) => seen.push(msg), owner);
    await harness.routing.send({ claudeUuid: "u1", content: "hi" });

    harness.routing.cleanupByOwner(owner);
    // The waiter must survive a transient disconnect.
    expect(harness.relay.hasPending("u1")).toBe(true);

    harness.relay.resolveResponse("u1", "late");
    await flush();

    expect(seen.length).toBe(2);
    expect(seen[0]).toMatchObject({ type: "stream_chunk" });
    expect(seen[1]).toEqual({ type: "stream_end", sessionId: "u1" });
  });

  test("E3: after a reconnect rebinds the uuid, only the new sink receives the reply", async () => {
    const harness = makeHarness();
    const sinkA: Record<string, unknown>[] = [];
    const sinkB: Record<string, unknown>[] = [];
    const ws1 = {};
    const ws2 = {};

    harness.routing.registerClient("u1", (msg) => sinkA.push(msg), ws1);
    await harness.routing.send({ claudeUuid: "u1", content: "hi" });
    harness.routing.registerClient("u1", (msg) => sinkB.push(msg), ws2);

    harness.relay.resolveResponse("u1", "hello");
    await flush();

    expect(sinkA).toEqual([]);
    expect(sinkB.length).toBe(2);
  });

  test("a cancelled waiter delivers nothing and rejects nothing unhandled", async () => {
    const harness = makeHarness();
    const seen: Record<string, unknown>[] = [];
    harness.routing.registerClient("u1", (msg) => seen.push(msg));
    await harness.routing.send({ claudeUuid: "u1", content: "hi" });

    harness.relay.cancel("u1");
    await flush();

    expect(seen).toEqual([]);
    expect(harness.relay.hasPending("u1")).toBe(false);
  });

  test("teardown cancels the waiter, unlike cleanupByOwner", async () => {
    const harness = makeHarness();
    harness.routing.registerClient("u1", () => {});
    await harness.routing.send({ claudeUuid: "u1", content: "hi" });

    harness.routing.teardown("u1");
    await flush();

    expect(harness.relay.hasPending("u1")).toBe(false);
    expect(harness.routing.getClient("u1")).toBeUndefined();
  });
});
