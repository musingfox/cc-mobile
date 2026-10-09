/**
 * send-routing.test.ts — HerdrPromptInjection + HerdrReplyDelivery.
 *
 * Runs against a fake herdr client and the real response relay, so the
 * arm/resolve/cancel ordering under test is the production one. The E1/E3
 * disconnect cases are the reason the arm-time sink exists at all.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TerminalSendOutcome } from "../terminal-backend";
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

    await expect(harness.routing.send({ claudeUuid: "u1", content: "x" })).resolves.toEqual({
      ok: false,
      code: "terminal_send_failed",
    });

    expect(seen.length).toBe(1);
    expect(seen[0]).toMatchObject({
      type: "error",
      sessionId: "u1",
      code: "terminal_send_failed",
    });
    expect(String(seen[0]?.message)).toContain("not reachable");
  });

  test("the target pane is prepared after readiness and before anything is typed", async () => {
    const harness = makeHarness();
    const routing = createHerdrSendRouting({
      client: harness.client,
      resolvePane: () => "p1",
      beforeInject: async (paneId) => {
        harness.order.push(`beforeInject(${paneId})`);
      },
    });
    routing.registerClient("u1", () => {});

    await routing.send({ claudeUuid: "u1", content: "hi" });

    expect(harness.order).toEqual([
      "agentGet(p1)",
      "paneRead(p1)",
      "beforeInject(p1)",
      'paneSendText(p1,"hi")',
      'paneSendKeys(p1,["Enter"])',
    ]);
  });

  test("a preparation that fails does not swallow the prompt", async () => {
    const harness = makeHarness();
    const routing = createHerdrSendRouting({
      client: harness.client,
      resolvePane: () => "p1",
      beforeInject: async () => {
        throw new Error("transcript unreadable");
      },
    });
    const seen: Record<string, unknown>[] = [];
    routing.registerClient("u1", (msg) => seen.push(msg));

    await routing.send({ claudeUuid: "u1", content: "hi" });

    expect(harness.order).toContain('paneSendKeys(p1,["Enter"])');
    expect(seen).toEqual([]);
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

  test("nobody is reported connected once the last connection closes", () => {
    // What the status poll backs off on. The sink survives the disconnect on
    // purpose (the case above), so ownership is the only thing that can answer
    // "is anyone actually listening" — if this ever stopped emptying, the poll
    // would run at full speed forever with nothing to run for.
    const harness = makeHarness();
    const owner = {};
    expect(harness.routing.hasClients()).toBe(false);

    harness.routing.registerClient("u1", () => {}, owner);
    expect(harness.routing.hasClients()).toBe(true);

    harness.routing.cleanupByOwner(owner);
    expect(harness.routing.hasClients()).toBe(false);
  });

  test("a sink bound with no connection behind it still counts as a listener", () => {
    const harness = makeHarness();
    harness.routing.registerClient("u1", () => {});

    expect(harness.routing.hasClients()).toBe(true);

    harness.routing.teardown("u1");
    expect(harness.routing.hasClients()).toBe(false);
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

  test("a turn that stops at a permission prompt counts as started", async () => {
    const statuses = ["idle", "idle", "blocked"];
    const keys: string[][] = [];
    const seen: Record<string, unknown>[] = [];
    const routing = createHerdrSendRouting({
      client: {
        paneSendText: async () => {},
        paneSendKeys: async (_pane, k) => void keys.push(k),
        agentGet: async () => ({ agent_status: statuses.shift() ?? "blocked" }),
        paneRead: async () => ({ text: readyScreen() }),
      },
      resolvePane: () => "p1",
      startPollMs: 1,
    });
    routing.registerClient("u1", (msg) => seen.push(msg));

    await routing.send({ claudeUuid: "u1", content: "hi", confirmStart: true });

    expect(keys).toEqual([["Enter"]]);
    expect(seen).toEqual([]);
  });

  test("a prompt taller than the screen is found in the scrollback and sent", async () => {
    // Live 2026-10-09: a card's composer outgrows the 40-row screen, so only
    // the scrollback still holds the box's top rule.
    let enters = 0;
    const routing = createHerdrSendRouting({
      client: {
        paneSendText: async () => {},
        paneSendKeys: async () => {
          enters += 1;
        },
        agentGet: async () => ({ agent_status: enters >= 2 ? "working" : "idle" }),
        paneRead: async (params) => ({
          text:
            params.source === "recent" && enters > 0
              ? readyScreen(" ❯ the card, still unsent")
              : ["  ## Notes", RULE, "  status line"].join("\n"),
        }),
      },
      resolvePane: () => "p1",
      startPollMs: 1,
      startWindowMs: 20,
    });
    routing.registerClient("u1", () => {});

    const outcome = await routing.send({
      claudeUuid: "u1",
      content: "the card, still unsent\nsecond line",
      confirmStart: true,
    });

    expect(outcome).toEqual({ ok: true });
    expect(enters).toBe(2);
  });
});

const IDLE_BOX = ["", RULE, "❯ ", RULE].join("\n");

/**
 * A pane whose prompt is typed and then sits there: the Enters are counted,
 * `status` answers each sample after the text, and `screen` is every read.
 */
function stalledPane(
  screen: string,
  status: () => Promise<{ agent_status?: string }>,
  options: { startWindowMs?: number } = {},
) {
  let typed = false;
  let enters = 0;
  const routing = createHerdrSendRouting({
    client: {
      paneSendText: async () => {
        typed = true;
      },
      paneSendKeys: async (_pane, keys) => {
        if (keys.includes("Enter")) enters += 1;
      },
      agentGet: async () => (typed ? status() : { agent_status: "idle" }),
      paneRead: async () => ({ text: typed ? screen : IDLE_BOX }),
    },
    resolvePane: () => "p1",
    startPollMs: 1,
    startWindowMs: options.startWindowMs ?? 20,
  });
  routing.registerClient("u1", () => {});
  const send = (content: string) => routing.send({ claudeUuid: "u1", content, confirmStart: true });
  return { send, extraEnters: () => enters - 1 };
}

const steadyIdle = async () => ({ agent_status: "idle" });
const failing = async (): Promise<{ agent_status?: string }> => {
  throw new Error("herdr agent.get: no response");
};
const fixture = (dir: string, name: string) =>
  readFileSync(join(import.meta.dir, dir, name), "utf8");

describe("PromptStartConfirmation retry Enter", () => {
  test("presses again on the live capture of a launch prompt left in the composer", async () => {
    const pane = stalledPane(fixture("fixtures", "claude-unsent-launch-prompt.txt"), steadyIdle);
    const outcome = await pane.send(
      "你正在被無人值守地派工，操作者可能不在終端機前。請遵守三條規則：\n\n1. …",
    );
    expect(outcome).toEqual({ ok: false, code: "prompt_not_started" });
    expect(pane.extraEnters()).toBe(2);
  });

  const captures = readdirSync(join(import.meta.dir, "permission", "fixtures")).filter((f) =>
    f.endsWith(".txt"),
  );
  for (const name of captures) {
    test(`presses nothing on the dialog capture ${name}, though the status sits still`, async () => {
      const screen = fixture(join("permission", "fixtures"), name);
      // The worst case: what was sent is the very line the screen shows after a caret.
      const caret = /^\s*[❯>]\s?(\S.*)$/m.exec(screen)?.[1]?.trim() ?? "# Task";
      const pane = stalledPane(screen, steadyIdle);
      expect(await pane.send(`${caret}\nmore`)).toEqual({ ok: false, code: "prompt_not_started" });
      expect(pane.extraEnters()).toBe(0);
    });
  }

  test("presses nothing on a question dialog while status samples fail (review repro 1)", async () => {
    for (const name of [
      "claude-ask-user-question.txt",
      "claude-ask-multiselect.txt",
      "claude-ask-stepper.txt",
    ]) {
      const pane = stalledPane(fixture(join("permission", "fixtures"), name), failing);
      expect(await pane.send("# Task")).toEqual({ ok: false, code: "prompt_not_started" });
      expect(pane.extraEnters()).toBe(0);
    }
  });

  test("presses nothing on a permission dialog under an earlier empty composer (review repro 2)", async () => {
    const screen = `${IDLE_BOX}\n${fixture(join("permission", "fixtures"), "blocked-bash-prompt.txt")}`;
    for (const status of [failing, steadyIdle]) {
      const pane = stalledPane(screen, status);
      expect(await pane.send("# Task")).toEqual({ ok: false, code: "prompt_not_started" });
      expect(pane.extraEnters()).toBe(0);
    }
  });

  test("one failed sample in a window is enough to press nothing", async () => {
    let calls = 0;
    const pane = stalledPane(fixture("fixtures", "claude-unsent-launch-prompt.txt"), async () => {
      calls += 1;
      if (calls === 2) throw new Error("socket closed");
      return { agent_status: "idle" };
    });
    expect(
      await pane.send("你正在被無人值守地派工，操作者可能不在終端機前。請遵守三條規則："),
    ).toEqual({
      ok: false,
      code: "prompt_not_started",
    });
    expect(pane.extraEnters()).toBe(0);
  });

  test("a sample the window closes on unanswered presses nothing (review round 3, repro 1)", async () => {
    const hang = () => new Promise<never>(() => {});
    const cases: ((n: number) => Promise<{ agent_status?: string }>)[] = [
      async (n) => (n === 1 ? { agent_status: "idle" } : hang()),
      async (n) => (n === 2 ? hang() : { agent_status: "idle" }),
    ];
    for (const status of cases) {
      let n = 0;
      const pane = stalledPane(
        fixture("fixtures", "claude-unsent-launch-prompt.txt"),
        () => status(++n),
        { startWindowMs: 100 },
      );
      expect(
        await pane.send("你正在被無人值守地派工，操作者可能不在終端機前。請遵守三條規則："),
      ).toEqual({
        ok: false,
        code: "prompt_not_started",
      });
      expect(pane.extraEnters()).toBe(0);
    }
  });

  test("an extra Enter that goes unanswered is unconfirmed; one the pane refuses is a failed send", async () => {
    const first = "你正在被無人值守地派工，操作者可能不在終端機前。請遵守三條規則：";
    const unsent = fixture("fixtures", "claude-unsent-launch-prompt.txt");
    const cases: [() => Promise<void>, TerminalSendOutcome][] = [
      [() => new Promise<void>(() => {}), { ok: false, code: "prompt_not_started" }],
      [
        async () => {
          throw new Error("pane is gone");
        },
        { ok: false, code: "terminal_send_failed" },
      ],
    ];
    for (const [extraEnter, expected] of cases) {
      let typed = false;
      let enters = 0;
      const routing = createHerdrSendRouting({
        client: {
          paneSendText: async () => {
            typed = true;
          },
          paneSendKeys: async () => {
            enters += 1;
            if (enters > 1) await extraEnter();
          },
          agentGet: async () => ({ agent_status: "idle" }),
          paneRead: async () => ({ text: typed ? unsent : IDLE_BOX }),
        },
        resolvePane: () => "p1",
        startPollMs: 1,
        startWindowMs: 20,
      });
      routing.registerClient("u1", () => {});
      expect(await routing.send({ claudeUuid: "u1", content: first, confirmStart: true })).toEqual(
        expected,
      );
      expect(enters).toBe(2);
    }
  });

  test("an unknown or missing status presses nothing", async () => {
    for (const reported of [{ agent_status: "unknown" }, {}]) {
      const pane = stalledPane(
        fixture("fixtures", "claude-unsent-launch-prompt.txt"),
        async () => reported,
      );
      expect(
        await pane.send("你正在被無人值守地派工，操作者可能不在終端機前。請遵守三條規則："),
      ).toEqual({
        ok: false,
        code: "prompt_not_started",
      });
      expect(pane.extraEnters()).toBe(0);
    }
  });

  test("a composer opening with some other text presses nothing", async () => {
    const pane = stalledPane(readyScreen(" ❯ something else entirely"), steadyIdle);
    expect(await pane.send("the prompt we typed")).toEqual({
      ok: false,
      code: "prompt_not_started",
    });
    expect(pane.extraEnters()).toBe(0);
  });

  test("the wait is bounded by the clock, however slowly agent.get answers (review repro 3)", async () => {
    const screen = readyScreen(" ❯ # Task");
    for (const status of [
      async () => {
        await Bun.sleep(60);
        return { agent_status: "idle" };
      },
      () => new Promise<{ agent_status?: string }>(() => {}),
    ]) {
      const pane = stalledPane(screen, status, { startWindowMs: 100 });
      const started = performance.now();
      expect(await pane.send("# Task")).toEqual({ ok: false, code: "prompt_not_started" });
      // Three windows of 100 ms at most, plus two screen reads and two Enters that answer at once.
      expect(performance.now() - started).toBeLessThan(450);
    }
  });
});
