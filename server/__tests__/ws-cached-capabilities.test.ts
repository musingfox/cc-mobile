/**
 * ws-cached-capabilities.test.ts — LegacyCapabilitiesPushRemoved.
 *
 * Opening a socket no longer delivers a machine-wide capabilities snapshot.
 * A round trip through get_server_config proves the open sequence has drained.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { startWsHarness, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe("LegacyCapabilitiesPushRemoved", () => {
  test("T1: connecting never delivers a capabilities frame", async () => {
    harness = await startWsHarness({});
    harness.send({ type: "get_server_config" });
    await harness.waitFor((m) => m.type === "server_config");
    expect(harness.received.filter((m) => m.type === "capabilities")).toEqual([]);
  });

  test("T2: the open path is still healthy", async () => {
    harness = await startWsHarness({});
    harness.send({ type: "get_server_config" });
    const reply = await harness.waitFor((m) => m.type === "server_config");
    expect(reply.type).toBe("server_config");
  });
});
