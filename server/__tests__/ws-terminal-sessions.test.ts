/**
 * ws-terminal-sessions.test.ts — TerminalSessionListQuery.
 *
 * The server's live terminal sessions are the authority a reconnecting client
 * reconciles its restored cards against: live ones become writable again, dead
 * ones are dropped. Before this message pair existed, a client that reloaded
 * mid-create had no way to ask, and its card stayed stuck unwritable forever
 * (#22).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ClientMessage, ServerMessage } from "../protocol";
import { startWsHarness, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

function backendWithLive(claudeUuids: string[]) {
  return {
    createSession: async () => ({ name: "n", paneRef: "p1", settingsPath: "/tmp/s" }),
    teardown: async () => ({ killed: false }),
    listLive: () => claudeUuids,
    send: async () => {},
    registerClient: () => {},
    cleanupByOwner: () => {},
  };
}

describe("TerminalSessionListQuery — protocol", () => {
  test("both halves of the message pair validate", () => {
    expect(ClientMessage.safeParse({ type: "list_terminal_sessions" }).success).toBe(true);
    expect(
      ServerMessage.safeParse({
        type: "terminal_sessions",
        claudeUuids: ["u1"],
        unknownUuids: ["u9"],
      }).success,
    ).toBe(true);
  });

  test("states is optional — a reply without it is still valid", () => {
    // Unlike the two arrays, a missing states map cannot be misread: it means
    // "no snapshot", which is exactly the pre-reconcile state the client
    // already renders as "no dot".
    expect(
      ServerMessage.safeParse({ type: "terminal_sessions", claudeUuids: ["u1"], unknownUuids: [] })
        .success,
    ).toBe(true);
  });

  test("an unrecognised state value is refused rather than passed through", () => {
    expect(
      ServerMessage.safeParse({
        type: "terminal_sessions",
        claudeUuids: ["u1"],
        unknownUuids: [],
        states: { u1: "bogus" },
      }).success,
    ).toBe(false);
  });

  test("the reply requires both lists — a missing one is not an empty one", () => {
    expect(ServerMessage.safeParse({ type: "terminal_sessions" }).success).toBe(false);
    expect(
      ServerMessage.safeParse({ type: "terminal_sessions", claudeUuids: "u1", unknownUuids: [] })
        .success,
    ).toBe(false);
    // unknownUuids is how the remount's "leave it alone" verdict travels; a
    // reply without it would let the client mistake skipped for dead.
    expect(
      ServerMessage.safeParse({ type: "terminal_sessions", claudeUuids: ["u1"] }).success,
    ).toBe(false);
    expect(
      ServerMessage.safeParse({ type: "terminal_sessions", claudeUuids: [], unknownUuids: "u9" })
        .success,
    ).toBe(false);
  });
});

describe("TerminalSessionListQuery — handler", () => {
  test("answers with the backend's live list, bare rather than enveloped", async () => {
    harness = await startWsHarness(backendWithLive(["u1", "u2"]));

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    expect(reply).toEqual({
      type: "terminal_sessions",
      claudeUuids: ["u1", "u2"],
      unknownUuids: [],
      states: {},
    });
    // A connection-scoped answer must not be buffered: replaying a stale list
    // to a later reconnect would delete cards that are alive by then.
    expect(harness.eventBuffer.replay("u1", 0)).toEqual([]);
    expect(harness.received.some((msg) => msg.type === "event")).toBe(false);
  });

  test("no live sessions answers with an empty list, not silence", async () => {
    harness = await startWsHarness(backendWithLive([]));

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    expect(reply).toEqual({
      type: "terminal_sessions",
      claudeUuids: [],
      unknownUuids: [],
      states: {},
    });
  });

  test("a backend that reports remount skips carries them as unknownUuids", async () => {
    harness = await startWsHarness({
      ...backendWithLive(["u1"]),
      listUnknown: () => ["u7"],
    });

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    // The remount's conservatism reaches the client: u7 was skipped, not
    // declared dead, so the reply must not lump it in with the missing.
    expect(reply).toEqual({
      type: "terminal_sessions",
      claudeUuids: ["u1"],
      unknownUuids: ["u7"],
      states: {},
    });
  });

  test("the reply carries what each live session is doing, unbuffered", async () => {
    harness = await startWsHarness({
      ...backendWithLive(["u1", "u2"]),
      listStates: async () => ({ u1: "running" as const }),
    });

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    // u2 is live but carries no key: the daemon had nothing usable to say, and
    // "no claim" must not be rounded down to "idle".
    expect(reply).toEqual({
      type: "terminal_sessions",
      claudeUuids: ["u1", "u2"],
      unknownUuids: [],
      states: { u1: "running" },
    });
    expect(harness.eventBuffer.replay("u1", 0)).toEqual([]);
  });

  test("a status lookup failure still answers the liveness question", async () => {
    harness = await startWsHarness({
      ...backendWithLive(["u1", "u2"]),
      listStates: async () => {
        throw new Error("socket closed");
      },
    });

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    // The dot degrades; the reconcile does not. Withholding the reply would
    // freeze every restored card instead of just dimming it.
    expect(reply).toEqual({
      type: "terminal_sessions",
      claudeUuids: ["u1", "u2"],
      unknownUuids: [],
      states: {},
    });
    expect(harness.received.some((msg) => msg.type === "error")).toBe(false);
  });

  test("the answer is read at query time, not captured earlier", async () => {
    const live: string[] = [];
    harness = await startWsHarness({ ...backendWithLive([]), listLive: () => live });

    harness.send({ type: "list_terminal_sessions" });
    await harness.waitFor((msg) => msg.type === "terminal_sessions");

    live.push("u3");
    harness.send({ type: "list_terminal_sessions" });
    const replies = await harness
      .waitFor(
        (msg) =>
          msg.type === "terminal_sessions" &&
          Array.isArray(msg.claudeUuids) &&
          msg.claudeUuids.length === 1,
      )
      .then(() => harness?.received.filter((msg) => msg.type === "terminal_sessions"));

    expect(replies?.map((msg) => msg.claudeUuids)).toEqual([[], ["u3"]]);
  });
});
