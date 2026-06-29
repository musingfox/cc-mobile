import { describe, expect, mock, test } from "bun:test";

// Stub the SDK so importing session-manager doesn't trigger plugin loading.
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mock(() => ({
    async *[Symbol.asyncIterator]() {},
    close() {},
  })),
}));

mock.module("../settings-loader", () => ({
  loadUserPlugins: async () => [],
}));

const { SessionManager } = await import("../session-manager");

function makeMgr() {
  return new SessionManager({ permissionMode: "default" });
}

function injectQuery(
  mgr: InstanceType<typeof SessionManager>,
  sessionId: string,
  stopTaskFn: (taskId: string) => Promise<void>,
): { stopTask: ReturnType<typeof mock> } {
  const stopTask = mock(stopTaskFn);
  const fakeQuery = {
    stopTask,
    close() {},
  } as unknown as import("@anthropic-ai/claude-agent-sdk").Query;
  // Access private field directly for test injection.
  (mgr as unknown as { activeQueries: Map<string, unknown> }).activeQueries.set(
    sessionId,
    fakeQuery,
  );
  return { stopTask };
}

describe("SessionManager.stopTask", () => {
  test("happy path: forwards taskId to the active Query's stopTask", async () => {
    const mgr = makeMgr();
    const { stopTask } = injectQuery(mgr, "s1", async () => {});
    const emitError = mock((_code: string, _msg: string) => {});

    await mgr.stopTask("s1", "t1", emitError);

    expect(stopTask).toHaveBeenCalledTimes(1);
    expect(stopTask.mock.calls[0][0]).toBe("t1");
    expect(emitError).not.toHaveBeenCalled();
  });

  test("no active query: emits no_active_query error, does not throw", async () => {
    const mgr = makeMgr();
    const emitError = mock((_code: string, _msg: string) => {});

    await mgr.stopTask("sX", "t1", emitError);

    expect(emitError).toHaveBeenCalledTimes(1);
    expect(emitError.mock.calls[0][0]).toBe("no_active_query");
    expect(emitError.mock.calls[0][1]).toBe("No active turn to stop");
  });

  test("SDK rejection: emits stop_task_failed error, does not throw", async () => {
    const mgr = makeMgr();
    injectQuery(mgr, "s1", async () => {
      throw new Error("SDK boom");
    });
    const emitError = mock((_code: string, _msg: string) => {});

    await mgr.stopTask("s1", "t1", emitError);

    expect(emitError).toHaveBeenCalledTimes(1);
    expect(emitError.mock.calls[0][0]).toBe("stop_task_failed");
    expect(emitError.mock.calls[0][1]).toBe("SDK boom");
  });
});
