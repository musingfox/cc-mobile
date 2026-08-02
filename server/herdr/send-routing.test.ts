/**
 * send-routing.test.ts — HerdrPromptInjection + HerdrReplyDelivery.
 *
 * Runs against a fake herdr client and the real response relay, so the
 * arm/resolve/cancel ordering under test is the production one. The E1/E3
 * disconnect cases are the reason the arm-time sink exists at all.
 */

import { describe, expect, test } from "bun:test";
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

  const routing = createHerdrSendRouting({
    client,
    resolvePane: (claudeUuid) => panes[claudeUuid],
    listDrivablePanes: async () => readiness.drivablePanes ?? [],
  });

  return { routing, order, client, agentWaitCalls: () => agentWaitCalls };
}

describe("HerdrPromptInjection", () => {
  test("types the prompt verbatim, then submits with Enter", async () => {
    const harness = makeHarness();
    const seen: Record<string, unknown>[] = [];
    harness.routing.registerClient("u1", (msg) => seen.push(msg));

    await harness.routing.send({ claudeUuid: "u1", content: "line1\nline2" });

    // Readiness is probed before anything is typed: a refusal must leave no
    // trace at all.
    expect(harness.order).toEqual([
      "agentGet(p1)",
      "paneRead(p1)",
      'paneSendText(p1,"line1\\nline2")',
      'paneSendKeys(p1,["Enter"])',
    ]);
    // The newline survives: no flattening on the herdr path.
    expect(harness.agentWaitCalls()).toBe(0);
    // Injecting says nothing by itself — the reply arrives later, from the
    // transcript, when herdr reports the turn settled.
    expect(seen).toEqual([]);
  });

  test("an unregistered uuid sends nothing at all", async () => {
    const harness = makeHarness({ u2: "p2" });

    await harness.routing.send({ claudeUuid: "u2", content: "x" });

    expect(harness.order).toEqual([]);
  });

  test("a failed injection reports terminal_send_failed", async () => {
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

    expect(seen.length).toBe(1);
    expect(seen[0]).toMatchObject({
      type: "error",
      sessionId: "u1",
      code: "terminal_send_failed",
    });
    expect(String(seen[0]?.message)).toContain("not reachable");
  });

  test("a session key that addresses no pane fails the same way rather than hanging", async () => {
    const harness = makeHarness({});
    const seen: Record<string, unknown>[] = [];
    harness.routing.registerClient("u1", (msg) => seen.push(msg));

    await harness.routing.send({ claudeUuid: "u1", content: "x" });

    expect(seen[0]).toMatchObject({ code: "terminal_send_failed" });
  });
});

describe("client sink map", () => {
  test("a disconnect keeps the sink installed so a late reply still reaches the buffer", async () => {
    // E1: the sink is the buffer-first wrapper, so a message arriving while the
    // phone is away is replayed on reconnect. Only the owner index is released.
    const harness = makeHarness();
    const owner = {};
    const sink = () => {};
    harness.routing.registerClient("u1", sink, owner);

    harness.routing.cleanupByOwner(owner);

    expect(harness.routing.getClient("u1")).toBe(sink);
  });

  test("a reconnect rebinds the session, and the newest sink wins", () => {
    // E3: transcript delivery looks the sink up at delivery time, so this is
    // the binding that decides where a turn lands.
    const harness = makeHarness();
    const sinkA = () => {};
    const sinkB = () => {};
    harness.routing.registerClient("u1", sinkA, {});
    harness.routing.registerClient("u1", sinkB, {});

    expect(harness.routing.getClient("u1")).toBe(sinkB);
  });

  test("teardown drops the sink, unlike cleanupByOwner", async () => {
    const harness = makeHarness();
    harness.routing.registerClient("u1", () => {});

    harness.routing.teardown("u1");

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
