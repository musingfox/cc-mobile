import { describe, expect, test } from "bun:test";
import type { Capabilities } from "../capabilities-cache";
import { emitCapabilitiesOnOpen } from "../ws";

// Fake ws with bare send (open/reconnect path)
function makeFakeWs() {
  const sent: Record<string, unknown>[] = [];
  return {
    send(msg: Record<string, unknown>) {
      sent.push(msg);
    },
    sent,
  };
}

const SAMPLE_CAPS: Capabilities = {
  commands: [{ name: "c" }],
  agents: [{ name: "a" }],
  model: "m",
};

describe("capabilities emit helpers", () => {
  // EX-1: open — cache non-null → exactly one frame with cache fields, no sessionId
  test("EX-1: emitCapabilitiesOnOpen with non-null cache emits one capabilities frame", () => {
    const ws = makeFakeWs();
    emitCapabilitiesOnOpen(ws, SAMPLE_CAPS);

    expect(ws.sent).toHaveLength(1);
    const frame = ws.sent[0];
    expect(frame.type).toBe("capabilities");
    expect(frame.commands).toEqual(SAMPLE_CAPS.commands);
    expect(frame.agents).toEqual(SAMPLE_CAPS.agents);
    expect(frame.model).toBe(SAMPLE_CAPS.model);
    expect(frame.sessionId).toBeUndefined();
  });

  // EX-2: open — cache null → no capabilities frame
  test("EX-2: emitCapabilitiesOnOpen with null cache emits nothing", () => {
    const ws = makeFakeWs();
    emitCapabilitiesOnOpen(ws, null);
    expect(ws.sent).toHaveLength(0);
  });

  // EX-3 covered the init path, which fed capabilities out of the SDK query's
  // system/init message. That path (and its emit helper) went with #25.
  // EX-4/EX-5 covered the resume path's emit helper, which went with #26 —
  // there is no resume any more, so the open path is the only emitter left.
});
