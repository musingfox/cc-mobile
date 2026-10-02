/**
 * ReplayedPromptCountdown — a buffered permission_request carries the
 * auto-deny time left when it was first sent. Replayed later that figure is
 * wrong: time has passed, and since every close freezes the server's
 * countdown, it is usually not running at all. The replay re-reads it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { startWsHarness, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const PANE = "w9R:p1";

function backend(autoDenyMs: number | undefined) {
  return {
    listLive: () => [],
    registerClient: () => {},
    cleanupByOwner: () => {},
    isPermissionCurrent: () => true,
    permissionAutoDenyMs: () => autoDenyMs,
  };
}

async function replayedPrompt(autoDenyMs: number | undefined) {
  harness = await startWsHarness(backend(autoDenyMs));
  harness.eventBuffer.append(PANE, {
    type: "permission_request",
    sessionId: PANE,
    requestId: "r1",
    tool: { name: "Bash command", parameters: { text: "touch x" } },
    options: [{ id: "1", label: "Yes", keystroke: "1" }],
    promptKind: "permission",
    autoDenyMs: 90_000,
  });

  harness.send({ type: "reconnect", lastEventId: null, sessionIds: [PANE] });
  await harness.waitFor((msg) => msg.type === "replay_complete");
  const envelope = harness.received.find((msg) => msg.type === "event") as {
    payload: Record<string, unknown>;
  };
  return envelope.payload;
}

describe("ReplayedPromptCountdown", () => {
  test("a frozen countdown is replayed as no countdown", async () => {
    const payload = await replayedPrompt(undefined);

    expect(payload.requestId).toBe("r1");
    expect("autoDenyMs" in payload).toBe(false);
  });

  test("a running countdown is replayed with what is left now", async () => {
    const payload = await replayedPrompt(42_000);

    expect(payload.autoDenyMs).toBe(42_000);
  });
});
