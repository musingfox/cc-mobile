/**
 * ws-capabilities-request.test.ts — CapabilitiesReplyDelivered and
 * CapabilitiesUnavailableSignalled.
 *
 * Drives the real WS plugin over a real socket so the Zod gate, the dispatch
 * and the event-buffer discipline are the production ones. Assertions are on
 * the frames the socket actually receives.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { startWsHarness, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe("CapabilitiesReplyDelivered", () => {
  test("T1: a successful list is one capabilities_list frame for that session", async () => {
    harness = await startWsHarness({
      readCapabilities: async () => ({
        ok: true,
        commands: [{ name: "help", description: "H", argumentHint: "<x>" }],
        agents: [{ name: "Explore" }],
      }),
    });
    harness.send({ type: "capabilities_request", sessionId: "w1:p1" });
    const frame = await harness.waitFor((m) => m.type === "capabilities_list");
    expect(frame).toEqual({
      type: "capabilities_list",
      sessionId: "w1:p1",
      commands: [{ name: "help", description: "H", argumentHint: "<x>" }],
      agents: [{ name: "Explore" }],
    });
  });

  test("T2: the answer never enters the session replay buffer", async () => {
    harness = await startWsHarness({
      readCapabilities: async () => ({
        ok: true,
        commands: [{ name: "help", description: "H", argumentHint: "<x>" }],
        agents: [{ name: "Explore" }],
      }),
    });
    harness.send({ type: "capabilities_request", sessionId: "w1:p1" });
    await harness.waitFor((m) => m.type === "capabilities_list");
    expect(harness.eventBuffer.replay("w1:p1", -1)).toEqual([]);
  });

  test("T3: an empty list is a delivered answer, not an error", async () => {
    harness = await startWsHarness({
      readCapabilities: async () => ({ ok: true, commands: [], agents: [] }),
    });
    harness.send({ type: "capabilities_request", sessionId: "w1:p1" });
    const frame = await harness.waitFor((m) => m.type === "capabilities_list");
    expect(frame.commands).toEqual([]);
    expect(frame.agents).toEqual([]);
    expect(harness.received.filter((m) => m.type === "error")).toEqual([]);
  });

  test("T4: refresh:true is forwarded to the backend", async () => {
    const seen: unknown[] = [];
    harness = await startWsHarness({
      readCapabilities: async (_sessionId, options) => {
        seen.push(options);
        return { ok: true, commands: [], agents: [] };
      },
    });
    harness.send({ type: "capabilities_request", sessionId: "w1:p1", refresh: true });
    await harness.waitFor((m) => m.type === "capabilities_list");
    expect(seen[0]).toEqual({ refresh: true });
  });

  test("T5: two requests on one connection each carry their own sessionId", async () => {
    harness = await startWsHarness({
      readCapabilities: async (sessionId) => ({
        ok: true,
        commands: [],
        agents: [],
        sessionId,
      }),
    });
    harness.send({ type: "capabilities_request", sessionId: "w1:p1" });
    harness.send({ type: "capabilities_request", sessionId: "w1:p2" });
    await harness.waitFor((m) => m.type === "capabilities_list" && m.sessionId === "w1:p2");
    const lists = harness.received.filter((m) => m.type === "capabilities_list");
    expect(lists.map((m) => m.sessionId).sort()).toEqual(["w1:p1", "w1:p2"]);
    expect(lists).toHaveLength(2);
  });
});
