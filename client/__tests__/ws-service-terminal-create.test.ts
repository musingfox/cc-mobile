import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * ClientSessionCreate — mobile "new session" starts a live terminal session:
 * the client owns the uuid, the session appears immediately as not-ready
 * (Loading), `terminal_created` flips it ready (Success), and a create error drops
 * the optimistic session with a toast (Error).
 */

class FakeWebSocket {
  send = mock((_data: string) => {});
}

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
    handleMessage: (msg: Record<string, unknown>) => void;
    pendingTerminalCreates: Set<string>;
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("wsService terminal session create", () => {
  let fake: FakeWebSocket;
  let prevWs: WebSocket | null;
  const originalToastError = toastService.error;

  beforeEach(() => {
    fake = new FakeWebSocket();
    prevWs = getInternal().ws;
    getInternal().ws = fake as unknown as WebSocket;
    getInternal().pendingTerminalCreates.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  afterEach(() => {
    getInternal().ws = prevWs;
    getInternal().pendingTerminalCreates.clear();
    toastService.error = originalToastError;
    // The store is a module singleton shared with every other test file — a
    // leftover agent list changes what ProjectDetailScreen renders over there.
    useAppStore.setState({ availableAgents: [] });
  });

  test("createTerminalSession emits one terminal_create and adds a not-ready session", () => {
    const claudeUuid = wsService.createTerminalSession("/tmp");

    expect(claudeUuid).not.toBeNull();
    expect(claudeUuid).toMatch(UUID_V4);

    expect(fake.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fake.send.mock.calls[0][0] as string);
    expect(payload).toEqual({ type: "terminal_create", claudeUuid, cwd: "/tmp" });

    const session = useAppStore.getState().sessions.get(claudeUuid as string);
    expect(session).toBeDefined();
    expect(session?.cwd).toBe("/tmp");
    expect(session?.terminal?.ready).toBe(false);
  });

  test("an agent kind rides along on terminal_create when one is chosen", () => {
    const claudeUuid = wsService.createTerminalSession("/tmp", "omp");

    const payload = JSON.parse(fake.send.mock.calls[0][0] as string);
    expect(payload).toEqual({ type: "terminal_create", claudeUuid, cwd: "/tmp", agentKind: "omp" });
  });

  test("server_config's availableAgents reaches the store, and a partial config leaves it alone", () => {
    getInternal().handleMessage({
      type: "server_config",
      config: { availableAgents: ["claude", "omp"] },
    });
    expect(useAppStore.getState().availableAgents).toEqual(["claude", "omp"]);

    // A set_model echo carries no agent list — losing it here would empty the
    // footer's agent choice for the rest of the connection.
    getInternal().handleMessage({ type: "server_config", config: { model: "opus" } });
    expect(useAppStore.getState().availableAgents).toEqual(["claude", "omp"]);
  });

  test("terminal_created flips the session to ready", () => {
    const claudeUuid = wsService.createTerminalSession("/tmp") as string;

    getInternal().handleMessage({
      type: "terminal_created",
      claudeUuid,
      terminalName: "ccm-xxxx",
      paneRef: "p1",
    });

    expect(useAppStore.getState().sessions.get(claudeUuid)?.terminal?.ready).toBe(true);
  });

  test("create error removes the pending session and toasts the server message", () => {
    const errorToast = mock((_msg: string): string | number => 0);
    toastService.error = errorToast as typeof toastService.error;

    const claudeUuid = wsService.createTerminalSession("/tmp") as string;

    getInternal().handleMessage({ type: "error", code: "terminal_error", message: "boom" });

    expect(useAppStore.getState().sessions.has(claudeUuid)).toBe(false);
    expect(errorToast).toHaveBeenCalledTimes(1);
    expect(errorToast).toHaveBeenCalledWith("boom");
  });

  test("an unrelated global error leaves the pending session alone", () => {
    toastService.error = mock((_msg: string): string | number => 0) as typeof toastService.error;

    const claudeUuid = wsService.createTerminalSession("/tmp") as string;

    getInternal().handleMessage({ type: "error", code: "some_other_error", message: "nope" });

    expect(useAppStore.getState().sessions.has(claudeUuid)).toBe(true);
  });

  test("is a no-op when the socket is down", () => {
    getInternal().ws = null;

    expect(wsService.createTerminalSession("/tmp")).toBeNull();
    expect(useAppStore.getState().sessions.size).toBe(0);
  });
});
