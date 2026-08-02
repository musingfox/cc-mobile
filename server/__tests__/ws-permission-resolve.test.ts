/**
 * ws-permission-resolve.test.ts — the transport half of PermissionAnswerKeySend.
 *
 * A tap on the phone has to reach the backend that presses the key in the pane.
 * The hook relay that used to hold pending requests is gone: claude is blocked
 * on its own screen, so there is no promise to resolve and nothing to time out
 * on the server side — the answer is a keystroke or it is nothing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { startWsHarness, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const backendStub = {
  createSession: async () => ({ name: "n", paneRef: "p1" }),
  teardown: async () => ({ killed: false }),
  listLive: () => [],
  send: async () => {},
  registerClient: () => {},
  cleanupByOwner: () => {},
};

function backendWithPermissions(handled = true) {
  const answered: { requestId: string; answer: unknown }[] = [];
  let paused = 0;
  let resumed = 0;
  const backend = {
    ...backendStub,
    resolvePermission: async (requestId: string, answer: unknown) => {
      answered.push({ requestId, answer });
      return handled;
    },
    pausePermissions: () => {
      paused += 1;
    },
    resumePermissions: async () => {
      resumed += 1;
    },
  };
  return { backend, answered, counts: () => ({ paused, resumed }) };
}

/** Waits for the WS reply to travel server-side before asserting. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("PermissionAnswerKeySend — transport dispatch", () => {
  test("an optionId answer reaches the backend verbatim", async () => {
    const { backend, answered } = backendWithPermissions();
    harness = await startWsHarness(backend);

    harness.send({ type: "permission", requestId: "r1", optionId: "3" });
    await settle();

    expect(answered).toEqual([{ requestId: "r1", answer: { optionId: "3" } }]);
  });

  test("the legacy allow form still reaches the backend during the migration window", async () => {
    const { backend, answered } = backendWithPermissions();
    harness = await startWsHarness(backend);

    harness.send({ type: "permission", requestId: "r1", allow: false });
    await settle();

    expect(answered).toEqual([{ requestId: "r1", answer: { allow: false } }]);
  });

  test("an id the backend does not own raises no error at the user", async () => {
    const { backend } = backendWithPermissions(false);
    harness = await startWsHarness(backend);

    harness.send({ type: "permission", requestId: "not-mine", allow: true });
    await settle();

    expect(harness.received.filter((msg) => msg.type === "error")).toEqual([]);
  });

  test("a permission carrying neither optionId nor allow is refused", async () => {
    const { backend, answered } = backendWithPermissions();
    harness = await startWsHarness(backend);

    harness.send({ type: "permission", requestId: "r1" });
    const error = await harness.waitFor((msg) => msg.type === "error");

    expect(error.code).toBe("invalid_message");
    expect(answered).toHaveLength(0);
  });

  test("a backend that fails to answer does not take the connection down", async () => {
    const backend = {
      ...backendStub,
      resolvePermission: async () => {
        throw new Error("daemon gone");
      },
    };
    harness = await startWsHarness(backend);

    harness.send({ type: "permission", requestId: "r1", optionId: "1" });
    harness.send({ type: "list_terminal_sessions" });

    await harness.waitFor((msg) => msg.type === "terminal_sessions");
  });

  test("a reconnect asks the backend to re-read prompts still on screen", async () => {
    const { backend, counts } = backendWithPermissions();
    harness = await startWsHarness(backend);

    harness.send({ type: "terminal_send", claudeUuid: "u1", content: "hi" });
    await settle();

    expect(counts().resumed).toBe(1);
  });
});
