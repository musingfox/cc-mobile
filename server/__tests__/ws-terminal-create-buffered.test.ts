/**
 * ws-terminal-create-buffered.test.ts — BufferedCreateAck.
 *
 * Creating a terminal session takes seconds (the readiness gate waits for
 * claude to become interactive), and a phone that backgrounds the tab in that
 * window drops the socket. The ack used to go out bare, so it was simply lost
 * and the reconnecting client sat on an unwritable card. Buffering it puts the
 * ack in the same replay path every other session event already uses.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { startWsHarness, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

function backend(overrides: Record<string, unknown> = {}) {
  return {
    createSession: async () => ({ name: "ccm-u1", paneRef: "pn-1", settingsPath: "/tmp/s.json" }),
    teardown: async () => ({ killed: false }),
    listLive: () => [],
    send: async () => {},
    registerClient: () => {},
    cleanupByOwner: () => {},
    ...overrides,
  };
}

describe("BufferedCreateAck", () => {
  test("the success ack arrives enveloped and is recoverable from the buffer", async () => {
    harness = await startWsHarness(backend());

    harness.send({ type: "terminal_create", claudeUuid: "u1", cwd: "/tmp" });
    const envelope = await harness.waitFor((msg) => msg.type === "event");

    expect(envelope.sessionId).toBe("u1");
    expect(envelope.payload).toMatchObject({
      type: "terminal_created",
      claudeUuid: "u1",
      terminalName: "ccm-u1",
      paneRef: "pn-1",
    });

    // The receipt that matters: a client that missed the live send recovers the
    // ack by replaying from before it.
    const buffered = harness.eventBuffer.replay("u1", 0);
    expect(buffered.length).toBe(1);
    expect(buffered[0]?.message).toMatchObject({ type: "terminal_created", claudeUuid: "u1" });
  });

  test("a reconnecting client replays the ack it missed", async () => {
    harness = await startWsHarness(backend());

    harness.send({ type: "terminal_create", claudeUuid: "u1", cwd: "/tmp" });
    await harness.waitFor((msg) => msg.type === "event");

    // Same buffer, fresh cursor — exactly what a reconnect asks for.
    harness.send({ type: "reconnect", lastEventId: null, sessionIds: ["u1"] });
    const replayed = await harness.waitFor((msg) => msg.type === "replay_complete");

    expect(replayed).toMatchObject({ sessionId: "u1", eventsReplayed: 1, gapDetected: false });
  });

  test("a rejected path replies bare and buffers nothing", async () => {
    harness = await startWsHarness(backend(), {
      port: 0,
      hostname: "127.0.0.1",
      defaultCwd: null,
      permissionMode: "default",
      allowedRoots: ["/nowhere-allowed"],
      basePath: "",
    });

    harness.send({ type: "terminal_create", claudeUuid: "u1", cwd: "/tmp" });
    const error = await harness.waitFor((msg) => msg.type === "error");

    expect(error).toMatchObject({ code: "path_not_allowed" });
    // An error names no session that exists, so replaying it later would only
    // resurrect a failure the client already handled.
    expect(harness.eventBuffer.replay("u1", 0)).toEqual([]);
    expect(harness.received.some((msg) => msg.type === "event")).toBe(false);
  });

  test("a failing createSession also replies bare", async () => {
    harness = await startWsHarness(
      backend({
        createSession: async () => {
          throw new Error("daemon refused");
        },
      }),
    );

    harness.send({ type: "terminal_create", claudeUuid: "u1", cwd: "/tmp" });
    const error = await harness.waitFor((msg) => msg.type === "error");

    expect(error).toMatchObject({ code: "terminal_error" });
    expect(harness.eventBuffer.replay("u1", 0)).toEqual([]);
  });
});
