import { describe, expect, test } from "bun:test";
import {
  buildCachedCapabilities,
  emitCapabilitiesOnInit,
  emitCapabilitiesOnOpen,
  emitCapabilitiesOnResume,
} from "../ws";

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

// Fake sendBuffered that collects the inner payload (the capabilities message)
function makeFakeSendBuffered() {
  const payloads: Record<string, unknown>[] = [];
  const fn = (_ws: unknown, _sessionId: string, msg: Record<string, unknown>) => {
    payloads.push(msg);
  };
  return { fn, payloads };
}

const SAMPLE_CAPS = buildCachedCapabilities(
  { slash_commands: [{ name: "c" }], agents: [{ name: "a" }], model: "m" },
  null,
);

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

  // EX-3: init — system/init message → one frame with sessionId + buildCachedCapabilities fields
  test("EX-3: emitCapabilitiesOnInit emits one frame with sessionId and capability fields", () => {
    const { fn, payloads } = makeFakeSendBuffered();
    const initMsg = {
      type: "system",
      subtype: "init",
      slash_commands: [{ name: "c" }],
      agents: [{ name: "a" }],
      model: "m",
    };
    const caps = buildCachedCapabilities(initMsg, null);

    emitCapabilitiesOnInit(fn, {}, "sess-42", caps);

    expect(payloads).toHaveLength(1);
    const frame = payloads[0];
    expect(frame.type).toBe("capabilities");
    expect(frame.sessionId).toBe("sess-42");
    expect(frame.commands).toEqual([{ name: "c" }]);
    expect(frame.agents).toEqual([{ name: "a" }]);
    expect(frame.model).toBe("m");
  });

  // EX-4: resume — cache non-null → one frame with sessionId + cache fields
  test("EX-4: emitCapabilitiesOnResume with non-null cache emits one frame with sessionId", () => {
    const { fn, payloads } = makeFakeSendBuffered();
    emitCapabilitiesOnResume(fn, {}, "sess-r", SAMPLE_CAPS);

    expect(payloads).toHaveLength(1);
    const frame = payloads[0];
    expect(frame.type).toBe("capabilities");
    expect(frame.sessionId).toBe("sess-r");
    expect(frame.commands).toEqual(SAMPLE_CAPS.commands);
    expect(frame.agents).toEqual(SAMPLE_CAPS.agents);
    expect(frame.model).toBe(SAMPLE_CAPS.model);
  });

  // EX-5: resume — cache null → no frame
  test("EX-5: emitCapabilitiesOnResume with null cache emits nothing", () => {
    const { fn, payloads } = makeFakeSendBuffered();
    emitCapabilitiesOnResume(fn, {}, "sess-r", null);
    expect(payloads).toHaveLength(0);
  });
});
