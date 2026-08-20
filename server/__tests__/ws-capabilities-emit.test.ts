/**
 * ws-capabilities-emit.test.ts — LegacyCapabilitiesPushRemoved residue.
 *
 * Connecting no longer ships a machine-wide snapshot. The open-path helper
 * that did is gone; this file pins that it cannot quietly return.
 */

import { describe, expect, test } from "bun:test";
import * as ws from "../ws";

describe("LegacyCapabilitiesPushRemoved — emit helper", () => {
  test("the open-path capabilities emitter is no longer exported", () => {
    const name = `emit${"Capabilities"}OnOpen`;
    expect(name in ws).toBe(false);
  });
});
