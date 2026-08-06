/**
 * ws-terminal-sessions.test.ts — TerminalSessionsPayload.
 *
 * The reply is now the daemon's whole picture, not this process's memory: every
 * claude on the machine, keyed by pane id, each carrying whether it can be read
 * back, whether cc-mobile owns it, and whether it still asks before it acts.
 * A reconnecting client reconciles its restored cards against exactly this.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ClientMessage, ServerMessage } from "../protocol";
import { startWsHarness, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "w3V:p1",
    agentSessionValue: "a21273d4-77e6-43dc-b9cb-3647561d1192",
    cwd: "/repo",
    origin: "self" as const,
    drivable: true,
    readable: true,
    gated: true,
    ...overrides,
  };
}

function backendListing(sessions: ReturnType<typeof descriptor>[]) {
  return {
    createSession: async () => ({ name: "n", paneRef: "p1" }),
    teardown: async () => ({ killed: false }),
    listLive: () => [],
    listSessionDescriptors: async () => sessions,
    send: async () => {},
    registerClient: () => {},
    cleanupByOwner: () => {},
  };
}

describe("TerminalSessionsPayload — protocol", () => {
  test("both halves of the message pair validate", () => {
    expect(ClientMessage.safeParse({ type: "list_terminal_sessions" }).success).toBe(true);
    expect(
      ServerMessage.safeParse({
        type: "terminal_sessions",
        sessions: [descriptor()],
        claudeUuids: ["w3V:p1"],
      }).success,
    ).toBe(true);
  });

  test("the capability flags round-trip on the wire", () => {
    const parsed = ServerMessage.safeParse({
      type: "terminal_sessions",
      sessions: [
        descriptor({ readable: false, agentSessionValue: null }),
        descriptor({ sessionId: "w9:p1", origin: "foreign", gated: false, state: "running" }),
      ],
      claudeUuids: ["w3V:p1", "w9:p1"],
    });

    expect(parsed.success).toBe(true);
    const sessions = parsed.success && "sessions" in parsed.data ? parsed.data.sessions : [];
    expect(sessions[0]).toMatchObject({ readable: false, agentSessionValue: null });
    expect(sessions[1]).toMatchObject({ origin: "foreign", gated: false, state: "running" });
  });

  test("states is optional — a reply without it is still valid", () => {
    expect(
      ServerMessage.safeParse({ type: "terminal_sessions", sessions: [], claudeUuids: [] }).success,
    ).toBe(true);
  });

  test("an unrecognised state value is refused rather than passed through", () => {
    expect(
      ServerMessage.safeParse({
        type: "terminal_sessions",
        sessions: [],
        claudeUuids: ["u1"],
        states: { u1: "bogus" },
      }).success,
    ).toBe(false);
  });

  test("the reply requires the sessions array and a well-formed descriptor", () => {
    expect(ServerMessage.safeParse({ type: "terminal_sessions" }).success).toBe(false);
    expect(
      ServerMessage.safeParse({ type: "terminal_sessions", claudeUuids: ["u1"] }).success,
    ).toBe(false);
    expect(
      ServerMessage.safeParse({ type: "terminal_sessions", sessions: "nope", claudeUuids: [] })
        .success,
    ).toBe(false);
    // A descriptor missing its capability flags would be read as "all false",
    // which is a card the user cannot use and cannot be told why.
    expect(
      ServerMessage.safeParse({
        type: "terminal_sessions",
        sessions: [{ sessionId: "w3V:p1", cwd: "/repo" }],
        claudeUuids: ["w3V:p1"],
      }).success,
    ).toBe(false);
  });
});

describe("TerminalSessionsPayload — handler", () => {
  test("answers with the daemon's whole listing, ids mirroring the descriptors", async () => {
    const sessions = [descriptor(), descriptor({ sessionId: "w9:p1", origin: "foreign" })];
    harness = await startWsHarness(backendListing(sessions));

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    expect(reply).toEqual({
      type: "terminal_sessions",
      sessions,
      claudeUuids: ["w3V:p1", "w9:p1"],
      states: {},
    });
    // A connection-scoped answer must not be buffered: replaying a stale list
    // to a later reconnect would delete cards that are alive by then.
    expect(harness.eventBuffer.replay("w3V:p1", 0)).toEqual([]);
    expect(harness.received.some((msg) => msg.type === "event")).toBe(false);
  });

  test("each card is told which kind of agent it is looking at", async () => {
    harness = await startWsHarness(
      backendListing([
        descriptor({ agent: "claude" }),
        descriptor({ sessionId: "w6C:p1", origin: "foreign", agent: "omp" }),
      ]),
    );

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    const sessions = reply.sessions as Record<string, unknown>[];
    expect(sessions[0]?.agent).toBe("claude");
    expect(sessions[1]?.agent).toBe("omp");
    // The id mirror is kind-blind: it is every listed pane, claude or not.
    expect(reply.claudeUuids).toEqual(["w3V:p1", "w6C:p1"]);
  });

  test("a pane whose kind herdr has not detected carries no kind at all", async () => {
    harness = await startWsHarness(backendListing([descriptor()]));

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    const sessions = reply.sessions as Record<string, unknown>[];
    // Not `agent: undefined`: an absent key is the only way to say "herdr has
    // not said", which the client must not round down to claude.
    expect(Object.keys(sessions[0] ?? {})).not.toContain("agent");
  });

  test("no live sessions answers with an empty list, not silence", async () => {
    harness = await startWsHarness(backendListing([]));

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    expect(reply).toEqual({
      type: "terminal_sessions",
      sessions: [],
      claudeUuids: [],
      states: {},
    });
  });

  test("no reply ever carries the retired unknownUuids key", async () => {
    harness = await startWsHarness(backendListing([descriptor()]));

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    // The remount scan that produced it is gone (Decision M12), so "skipped,
    // leave the card alone" has no referent any more.
    expect(Object.keys(reply)).not.toContain("unknownUuids");
  });

  test("the reply carries what each live session is doing, unbuffered", async () => {
    harness = await startWsHarness({
      ...backendListing([descriptor(), descriptor({ sessionId: "w9:p1" })]),
      listStates: async () => ({ "w3V:p1": "running" as const }),
    });

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    // w9:p1 is live but carries no key: the daemon had nothing usable to say,
    // and "no claim" must not be rounded down to "idle".
    expect(reply.states).toEqual({ "w3V:p1": "running" });
    expect(harness.eventBuffer.replay("w3V:p1", 0)).toEqual([]);
  });

  test("a status lookup failure still answers the liveness question", async () => {
    harness = await startWsHarness({
      ...backendListing([descriptor()]),
      listStates: async () => {
        throw new Error("socket closed");
      },
    });

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    // The dot degrades; the reconcile does not. Withholding the reply would
    // freeze every restored card instead of just dimming it.
    expect(reply.states).toEqual({});
    expect(reply.claudeUuids).toEqual(["w3V:p1"]);
    expect(harness.received.some((msg) => msg.type === "error")).toBe(false);
  });

  test("a listing failure answers an empty list rather than an error frame", async () => {
    harness = await startWsHarness({
      ...backendListing([]),
      listSessionDescriptors: async () => {
        throw new Error("socket closed");
      },
    });

    harness.send({ type: "list_terminal_sessions" });
    const reply = await harness.waitFor((msg) => msg.type === "terminal_sessions");

    expect(reply.sessions).toEqual([]);
    // An error frame here would surface as a failed action on a screen the user
    // only asked to refresh; "nothing is running" is the answer they can act on.
    expect(harness.received.some((msg) => msg.type === "error")).toBe(false);
  });

  test("the answer is read at query time, not captured earlier", async () => {
    let live: ReturnType<typeof descriptor>[] = [];
    harness = await startWsHarness({
      ...backendListing([]),
      listSessionDescriptors: async () => live,
    });

    harness.send({ type: "list_terminal_sessions" });
    await harness.waitFor((msg) => msg.type === "terminal_sessions");

    live = [descriptor({ sessionId: "w7:p1" })];
    harness.send({ type: "list_terminal_sessions" });
    const replies = await harness
      .waitFor(
        (msg) =>
          msg.type === "terminal_sessions" &&
          Array.isArray(msg.claudeUuids) &&
          msg.claudeUuids.length === 1,
      )
      .then(() => harness?.received.filter((msg) => msg.type === "terminal_sessions"));

    expect(replies?.map((msg) => msg.claudeUuids)).toEqual([[], ["w7:p1"]]);
  });

  test("binds this socket as the sink for every listed session", async () => {
    const bound: string[] = [];
    harness = await startWsHarness({
      ...backendListing([descriptor(), descriptor({ sessionId: "w9:p1", origin: "foreign" })]),
      registerClient: (sessionId: string) => {
        bound.push(sessionId);
      },
    });

    harness.send({ type: "list_terminal_sessions" });
    await harness.waitFor((msg) => msg.type === "terminal_sessions");

    // Foreign sessions included: without a sink they would get no status, no
    // transcript readback and no permission prompt.
    expect(bound.sort()).toEqual(["w3V:p1", "w9:p1"]);
  });
});
