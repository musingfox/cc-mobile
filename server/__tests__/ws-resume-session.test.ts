/**
 * ws-resume-session.test.ts — ResumeLoadsHistory.
 *
 * Opening a past session from the Projects screen must still load and display
 * that conversation. #25 narrowed the call this case makes from
 * `createSession(sessionId, cwd, canUseTool, sdkSessionId)` to
 * `createSession(sessionId, cwd, sdkSessionId)` — three same-typed string
 * arguments became two, which no type checker can protect from a transposition.
 * These cases drive the real plugin so the narrowed call is actually exercised.
 *
 * The `messages.length > 0` half of the contract is covered a layer down in
 * session-history.test.ts, which can stub the SDK reader; here the point is the
 * WS-level ordering, the path guards, and that the sdkSessionId reaches the
 * session map rather than the cwd slot.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import type { ServerConfig } from "../config";
import { SessionManager } from "../session-manager";
import { startWsHarness, testServerConfig, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const backendStub = {
  createSession: async () => ({ name: "n", paneRef: "p1", settingsPath: "/tmp/s" }),
  teardown: async () => ({ killed: false }),
  listLive: () => [],
  send: async () => {},
  registerClient: () => {},
  cleanupByOwner: () => {},
};

/** Unwraps the payload of a buffered `event` envelope of the given type. */
function payloadOf(h: WsHarness, type: string): Record<string, unknown> | undefined {
  const envelope = h.received.find(
    (m) => m.type === "event" && (m.payload as Record<string, unknown>)?.type === type,
  );
  return envelope?.payload as Record<string, unknown> | undefined;
}

async function start(sessionManager: SessionManager, serverConfig: ServerConfig) {
  harness = await startWsHarness(backendStub, serverConfig, { sessionManager });
  return harness;
}

describe("ResumeLoadsHistory", () => {
  test("a resume creates the session and follows it with a history frame", async () => {
    const sessionManager = new SessionManager({ permissionMode: "default" });
    const h = await start(sessionManager, testServerConfig);

    h.send({ type: "resume_session", sdkSessionId: "abc-123-no-such-session", cwd: tmpdir() });

    await h.waitFor(
      (m) =>
        m.type === "event" && (m.payload as Record<string, unknown>)?.type === "session_history",
    );

    const created = payloadOf(h, "session_created");
    const history = payloadOf(h, "session_history");
    expect(created).toBeDefined();
    expect(history).toBeDefined();
    expect(created?.cwd).toBe(tmpdir());

    // session_created must arrive before session_history.
    const order = h.received
      .filter((m) => m.type === "event")
      .map((m) => (m.payload as Record<string, unknown>).type);
    expect(order.indexOf("session_created")).toBeLessThan(order.indexOf("session_history"));

    // Both frames describe the same server-side session id.
    expect(history?.sessionId).toBe(created?.sessionId);
    expect(sessionManager.hasSession(created?.sessionId as string)).toBe(true);
  });

  /**
   * Emptiness is deliberately NOT asserted: another test file installs a
   * persistent `mock.module` on the agent SDK's message reader, and bun's module
   * mocks leak across files, so whether the loader finds messages for an
   * unknown id depends on file order. What the contract actually claims — a
   * history that cannot be read is still answered, and is not fatal — is
   * order-independent and is what is asserted here.
   */
  test("an unreadable history still answers, and is not an error", async () => {
    const sessionManager = new SessionManager({ permissionMode: "default" });
    const h = await start(sessionManager, testServerConfig);

    h.send({ type: "resume_session", sdkSessionId: "definitely-not-on-disk", cwd: tmpdir() });

    await h.waitFor(
      (m) =>
        m.type === "event" && (m.payload as Record<string, unknown>)?.type === "session_history",
    );

    expect(Array.isArray(payloadOf(h, "session_history")?.messages)).toBe(true);
    expect(h.received.filter((m) => m.type === "error")).toEqual([]);
  });

  test("the sdkSessionId lands in the session map, not in the cwd slot", async () => {
    const sessionManager = new SessionManager({ permissionMode: "default" });
    const h = await start(sessionManager, testServerConfig);

    h.send({ type: "resume_session", sdkSessionId: "sdk-uuid-42", cwd: tmpdir() });
    await h.waitFor(
      (m) =>
        m.type === "event" && (m.payload as Record<string, unknown>)?.type === "session_history",
    );

    const sessionId = payloadOf(h, "session_created")?.sessionId as string;
    const stored = (
      sessionManager as unknown as {
        sessions: Map<string, { cwd: string; sdkSessionId: string | null }>;
      }
    ).sessions.get(sessionId);

    expect(stored?.cwd).toBe(tmpdir());
    expect(stored?.sdkSessionId).toBe("sdk-uuid-42");
  });

  test("a cwd outside the allowed roots is refused before any session is created", async () => {
    const sessionManager = new SessionManager({ permissionMode: "default" });
    const h = await start(sessionManager, { ...testServerConfig, allowedRoots: [tmpdir()] });

    h.send({ type: "resume_session", sdkSessionId: "abc-123", cwd: "/etc" });

    const error = await h.waitFor((m) => m.type === "error");
    expect(error.code).toBe("path_not_allowed");
    expect(payloadOf(h, "session_created")).toBeUndefined();
  });
});
