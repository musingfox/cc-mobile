import { describe, expect, mock, test } from "bun:test";
import { SessionManager } from "../session-manager";

/**
 * StopTaskReportsNoActiveQuery.
 *
 * Stopping a subagent task used to reach into the live SDK `Query`. That driver
 * was removed in #25, so there is nothing in-process left to stop: every call
 * reports `no_active_query`. This is the deliberate no-op state (plan D3), not
 * a regression — the case is pinned here so a reviewer can tell the difference.
 */
function makeMgr() {
  return new SessionManager({ permissionMode: "default" });
}

describe("SessionManager.stopTask", () => {
  test("known session: emits no_active_query, does not throw", async () => {
    const mgr = makeMgr();
    await mgr.createSession("s1", "/cwd");
    const emitError = mock((_code: string, _msg: string) => {});

    await mgr.stopTask("s1", "t1", emitError);

    expect(emitError).toHaveBeenCalledTimes(1);
    expect(emitError.mock.calls[0][0]).toBe("no_active_query");
    expect(emitError.mock.calls[0][1]).toBe("No active turn to stop");
  });

  test("unknown session: same no_active_query answer, still does not throw", async () => {
    const mgr = makeMgr();
    const emitError = mock((_code: string, _msg: string) => {});

    await mgr.stopTask("sX", "t1", emitError);

    expect(emitError).toHaveBeenCalledTimes(1);
    expect(emitError.mock.calls[0][0]).toBe("no_active_query");
  });
});
