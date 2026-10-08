import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { loadDraft, saveDraft } from "../services/draft-persistence";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

function getInternal() {
  return wsService as unknown as {
    ws: WebSocket | null;
    handleMessage: (msg: Record<string, unknown>) => void;
    pendingTerminalCreates: Set<string>;
  };
}

function entry(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    agentSessionValue: `value-${sessionId}`,
    cwd: "/tmp",
    origin: "self",
    drivable: true,
    readable: true,
    gated: true,
    ...overrides,
  };
}

const store = () => useAppStore.getState();

describe("terminal_sessions herdr sides", () => {
  const originalToastInfo = toastService.info;
  let infoToast: ReturnType<typeof mock>;

  beforeEach(() => {
    getInternal().pendingTerminalCreates.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, herdrStatus: null });
    infoToast = mock((_msg: string): string | number => 0);
    toastService.info = infoToast as typeof toastService.info;
    localStorage.clear();
  });

  afterEach(() => {
    toastService.info = originalToastInfo;
    getInternal().pendingTerminalCreates.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, herdrStatus: null });
    localStorage.clear();
  });

  describe("ClientKeepsOfflineSideCards", () => {
    test("T1 offline hangar keeps its card and draft, online cockpit sweeps its own", () => {
      store().addSession("fleet@w1:p1", "/tmp", { ready: false });
      store().addSession("w1:p1", "/tmp", { ready: false });
      saveDraft("fleet@w1:p1", "half typed");

      getInternal().handleMessage({
        type: "terminal_sessions",
        sessions: [],
        claudeUuids: [],
        herdr: { cockpit: { online: true }, hangar: { name: "fleet", online: false } },
      });

      expect(store().sessions.has("fleet@w1:p1")).toBe(true);
      expect(loadDraft("fleet@w1:p1")).toBe("half typed");
      expect(store().sessions.has("w1:p1")).toBe(false);
      expect(infoToast).toHaveBeenCalledTimes(1);
      expect(infoToast).toHaveBeenCalledWith("Terminal session ended");
    });

    test("T2 offline cockpit keeps every cockpit card, no toast, status stored", () => {
      store().addSession("w1:p1", "/tmp", { ready: false });
      store().addSession("w2:p1", "/tmp", { ready: false });
      const herdr = { cockpit: { online: false } };

      getInternal().handleMessage({ type: "terminal_sessions", sessions: [], herdr });

      expect(store().sessions.has("w1:p1")).toBe(true);
      expect(store().sessions.has("w2:p1")).toBe(true);
      expect(infoToast).not.toHaveBeenCalled();
      expect(store().herdrStatus).toEqual(herdr);
    });

    test("T3 a frame without herdr sweeps as before and clears the status", () => {
      store().addSession("w1:p1", "/tmp", { ready: false });
      store().setHerdrStatus({ cockpit: { online: false } });

      getInternal().handleMessage({ type: "terminal_sessions", sessions: [], claudeUuids: [] });

      expect(store().sessions.has("w1:p1")).toBe(false);
      expect(store().herdrStatus).toBeNull();
    });

    test("T4 a descriptor's side outranks the key when the hangar is online", () => {
      store().upsertListedSession({
        sessionId: "fleet@w1:p1",
        cwd: "/tmp",
        origin: "self",
        drivable: true,
        readable: true,
        gated: true,
        side: "hangar",
      });

      getInternal().handleMessage({
        type: "terminal_sessions",
        sessions: [],
        herdr: { cockpit: { online: true }, hangar: { name: "fleet", online: true } },
      });

      expect(store().sessions.has("fleet@w1:p1")).toBe(false);
    });

    test("T5 an unrecognised herdr shape is treated as absent", () => {
      store().addSession("w1:p1", "/tmp", { ready: false });

      getInternal().handleMessage({ type: "terminal_sessions", sessions: [], herdr: "bogus" });

      expect(store().sessions.has("w1:p1")).toBe(false);
      expect(store().herdrStatus).toBeNull();
    });
  });

  describe("ClientListsBothSides", () => {
    test("T1 a cockpit and a hangar w1:p1 stay two cards with their sides", () => {
      getInternal().handleMessage({
        type: "terminal_sessions",
        sessions: [
          entry("w1:p1", { side: "cockpit", cwd: "/a" }),
          entry("fleet@w1:p1", { side: "hangar", cwd: "/b" }),
        ],
      });

      expect(store().sessions.size).toBe(2);
      expect(store().sessions.get("w1:p1")?.descriptor?.side).toBe("cockpit");
      expect(store().sessions.get("w1:p1")?.cwd).toBe("/a");
      expect(store().sessions.get("fleet@w1:p1")?.descriptor?.side).toBe("hangar");
      expect(store().sessions.get("fleet@w1:p1")?.cwd).toBe("/b");
    });

    test("T2 a descriptor without side carries no side key", () => {
      getInternal().handleMessage({ type: "terminal_sessions", sessions: [entry("w1:p1")] });

      const descriptor = store().sessions.get("w1:p1")?.descriptor;
      expect(descriptor?.side).toBeUndefined();
      expect(descriptor && "side" in descriptor).toBe(false);
    });

    test("T3 an unknown side is dropped", () => {
      getInternal().handleMessage({
        type: "terminal_sessions",
        sessions: [entry("w1:p1", { side: "bogus" })],
      });

      expect(store().sessions.get("w1:p1")?.descriptor?.side).toBeUndefined();
    });
  });
});
