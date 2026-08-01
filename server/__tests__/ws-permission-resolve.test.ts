/**
 * ws-permission-resolve.test.ts — PermissionReplyBroadcast.
 *
 * A permission reply from the phone has to reach whichever relay is holding the
 * request. The tmux/herdr relay was missing from that broadcast, so a hook
 * waiting on the herdr path could only ever be released by its own 90s
 * timeout-deny — Allow was unreachable no matter what the user tapped.
 *
 * The relay under test is the real `createPtyPermissionRelay`, driven through
 * the real WS plugin, so what is asserted is the pending promise's resolution
 * value — the very thing the HTTP hook response carries back to claude.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createPtyPermissionRelay } from "../pty-permission-relay";
import { startWsHarness, type WsHarness } from "./ws-harness";

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

/** Long timeout: these cases must observe the reply, never a timeout-deny. */
function makeRelay() {
  const sent: Array<{ sessionId: string; requestId: string }> = [];
  const relay = createPtyPermissionRelay(
    (sessionId, requestId) => {
      sent.push({ sessionId, requestId });
    },
    { timeoutMs: 600_000 },
  );
  return { relay, sent };
}

/** Waits for the WS reply to travel server-side before asserting. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("PermissionReplyBroadcast", () => {
  test("an allow reply resolves the tmux/herdr relay's pending request", async () => {
    const { relay, sent } = makeRelay();
    harness = await startWsHarness(backendStub, undefined, { tmuxPermissionRelay: relay });

    const pending = relay.requestPtyPermission({
      sessionId: "u1",
      toolUseId: "toolu_01X",
      toolName: "Bash",
      toolInput: {},
    });
    expect(sent).toEqual([{ sessionId: "u1", requestId: "toolu_01X" }]);
    expect(relay.getPendingCount()).toBe(1);

    harness.send({ type: "permission", requestId: "toolu_01X", allow: true });

    expect(await pending).toEqual({ allow: true, answers: undefined });
    expect(relay.getPendingCount()).toBe(0);
  });

  test("a deny reply resolves the same pending request with allow:false", async () => {
    const { relay } = makeRelay();
    harness = await startWsHarness(backendStub, undefined, { tmuxPermissionRelay: relay });

    const pending = relay.requestPtyPermission({
      sessionId: "u1",
      toolUseId: "toolu_01Y",
      toolName: "Bash",
      toolInput: { command: "rm -rf /" },
    });

    harness.send({ type: "permission", requestId: "toolu_01Y", allow: false });

    expect(await pending).toEqual({ allow: false, answers: undefined });
    expect(relay.getPendingCount()).toBe(0);
  });

  test("answers ride along to the tmux/herdr relay", async () => {
    const { relay } = makeRelay();
    harness = await startWsHarness(backendStub, undefined, { tmuxPermissionRelay: relay });

    const pending = relay.requestPtyPermission({
      sessionId: "u1",
      toolUseId: "toolu_01Z",
      toolName: "AskUserQuestion",
      toolInput: {},
    });

    harness.send({
      type: "permission",
      requestId: "toolu_01Z",
      allow: true,
      answers: { q1: "yes" },
    });

    expect(await pending).toEqual({ allow: true, answers: { q1: "yes" } });
  });

  test("an unknown requestId is a silent no-op — no pending is mis-resolved", async () => {
    const { relay } = makeRelay();
    harness = await startWsHarness(backendStub, undefined, { tmuxPermissionRelay: relay });

    let settled = false;
    const pending = relay.requestPtyPermission({
      sessionId: "u1",
      toolUseId: "toolu_01A",
      toolName: "Bash",
      toolInput: {},
    });
    pending.then(() => {
      settled = true;
    });

    harness.send({ type: "permission", requestId: "unknown-id", allow: true });
    await settle();

    expect(settled).toBe(false);
    expect(relay.getPendingCount()).toBe(1);
    // Harness teardown would otherwise leave a 600s timer armed.
    relay.resolvePermission("toolu_01A", false);
    await pending;
  });
});
