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

/** A composer box in herdr's own shape: body between the last two rules. */
const RULE = "─".repeat(60);
export function readyScreen(composer = " ❯ "): string {
  return ["❯ an earlier turn", "", RULE, composer, RULE, "  ⏵⏵ accept edits on"].join("\n");
}

function makeHarness(
  panes: Record<string, string> = { u1: "p1" },
  clientOverrides: Partial<{
    paneSendText: (paneId: string, text: string) => Promise<void>;
    paneSendKeys: (paneId: string, keys: string[]) => Promise<void>;
  }> = {},
  readiness: { status?: string; screen?: string; drivablePanes?: string[] } = {},
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
    agentGet: async (target: string) => {
      order.push(`agentGet(${target})`);
      return { agent_status: readiness.status ?? "idle" };
    },
    paneRead: async (params: { pane_id: string }) => {
      order.push(`paneRead(${params.pane_id})`);
      return { text: readiness.screen ?? readyScreen() };
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
    listDrivablePanes: async () => readiness.drivablePanes ?? [],
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

    // Readiness is probed BEFORE the waiter is armed: a refusal must leave no
    // pending turn behind for the UI to spin on.
    expect(harness.order).toEqual([
      "agentGet(p1)",
      "paneRead(p1)",
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

  test("a failed injection cancels the waiter and reports terminal_send_failed", async () => {
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
      code: "terminal_send_failed",
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

    expect(seen[0]).toMatchObject({ code: "terminal_send_failed" });
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

/**
 * PromptInjectionReadinessGate — the phone can drive a session the user opened
 * in their own terminal, so "inject a prompt" now means "type into a composer a
 * human may be sitting in front of".
 */
describe("PromptInjectionReadinessGate", () => {
  function gateHarness(readiness: { status?: string; screen?: string; drivablePanes?: string[] }) {
    const harness = makeHarness({ u1: "p1" }, {}, readiness);
    const seen: Record<string, unknown>[] = [];
    harness.routing.registerClient("u1", (msg) => seen.push(msg));
    return { ...harness, seen };
  }

  test("an idle pane with an empty composer receives the prompt", async () => {
    const h = gateHarness({ status: "idle" });

    await h.routing.send({ claudeUuid: "u1", content: "hi" });

    expect(h.order).toContain('paneSendText(p1,"hi")');
    expect(h.order).toContain('paneSendKeys(p1,["Enter"])');
    expect(h.seen).toEqual([]);
  });

  test("a working pane is refused with session_busy and no injection RPC", async () => {
    const h = gateHarness({ status: "working" });

    await h.routing.send({ claudeUuid: "u1", content: "hi" });

    expect(h.order.some((call) => call.startsWith("paneSend"))).toBe(false);
    expect(h.relay.hasPending("u1")).toBe(false);
    expect(h.seen).toEqual([
      {
        type: "error",
        sessionId: "u1",
        code: "session_busy",
        message: expect.stringContaining("busy"),
      },
    ]);
  });

  test("a half-typed composer is refused rather than interleaved", async () => {
    const h = gateHarness({ status: "idle", screen: readyScreen(" ❯ half typed") });

    await h.routing.send({ claudeUuid: "u1", content: "hi" });

    expect(h.order.some((call) => call.startsWith("paneSend"))).toBe(false);
    expect((h.seen[0] as { code: string }).code).toBe("session_busy");
  });

  test("a pending permission prompt is not a composer", async () => {
    const h = gateHarness({ status: "blocked" });

    await h.routing.send({ claudeUuid: "u1", content: "hi" });

    expect(h.order.some((call) => call.startsWith("paneSend"))).toBe(false);
    expect((h.seen[0] as { code: string }).code).toBe("session_busy");
  });

  test("an ungated pane is driven exactly like any other (Decision H4)", async () => {
    // No permission-mode check exists anywhere on this path: the pane's mode is
    // disclosed to the user as a badge, never used to refuse their prompt.
    const h = gateHarness({ status: "idle" });

    await h.routing.send({ claudeUuid: "u1", content: "run it" });

    expect(h.order).toContain('paneSendText(p1,"run it")');
    expect(h.seen).toEqual([]);
  });

  test("a session key that is a pane id drives that pane, with no registry entry", async () => {
    // Every session the user started in their own terminal: the registry has
    // never heard of it and never will (Decision H1/H5).
    const harness = makeHarness({}, {}, { status: "idle", drivablePanes: ["w9:p1"] });
    const seen: Record<string, unknown>[] = [];
    harness.routing.registerClient("w9:p1", (msg) => seen.push(msg));

    await harness.routing.send({ claudeUuid: "w9:p1", content: "continue" });

    expect(harness.order).toContain('paneSendText(w9:p1,"continue")');
    expect(seen).toEqual([]);
  });

  test("a daemon that cannot answer the readiness probe does not swallow the prompt", async () => {
    const harness = makeHarness({ u1: "p1" }, {}, { status: "idle" });
    harness.client.agentGet = async () => {
      throw new Error("socket closed");
    };
    harness.routing.registerClient("u1", () => {});

    await harness.routing.send({ claudeUuid: "u1", content: "hi" });

    expect(harness.order).toContain('paneSendText(p1,"hi")');
  });
});
