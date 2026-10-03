import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { notificationService } from "../services/notification";
import { toastService } from "../services/toast-service";
import {
  pendingFromPermissionRequest,
  permissionResolution,
  wsService,
} from "../services/ws-service";
import { useAppStore } from "../stores/app-store";
import { useSettingsStore } from "../stores/settings-store";

/**
 * The kind the server read off the screen has to survive the frame being
 * unwrapped, because the card's wording depends on it — and an unparsed screen
 * must stay kindless rather than be filled in here.
 */
describe("QuestionKindReachesTheCard", () => {
  const frame = {
    type: "permission_request",
    sessionId: "p1",
    requestId: "r1",
    tool: { name: "A 或 B", parameters: { text: "這次要選 A 還是 B？" } },
    options: [{ id: "1", label: "A", keystroke: "1" }],
  };

  test("T1: a question frame reaches the card as a question", () => {
    const pending = pendingFromPermissionRequest({ ...frame, promptKind: "question" });

    expect(pending.requestId).toBe("r1");
    expect(pending.tool).toEqual({ name: "A 或 B", parameters: { text: "這次要選 A 還是 B？" } });
    expect(pending.options).toEqual([{ id: "1", label: "A", keystroke: "1" }]);
    expect(pending.promptKind).toBe("question");
  });

  test("T2: a frame without the key keeps its options and claims no kind", () => {
    const pending = pendingFromPermissionRequest(frame);

    expect(pending.promptKind).toBeUndefined();
    expect(pending.options).toHaveLength(1);
  });

  test("T3: an unknown kind is dropped, and missing options become Cancel-only", () => {
    const pending = pendingFromPermissionRequest({
      type: "permission_request",
      sessionId: "p1",
      requestId: "r1",
      tool: { name: "A 或 B", parameters: { text: "這次要選 A 還是 B？" } },
      promptKind: "whatever",
    });

    expect(pending.promptKind).toBeUndefined();
    expect(pending.options).toEqual([]);
  });
});

/**
 * The server sends how long it will wait before pressing Esc; the card keeps a
 * deadline on this device's clock, so a redraw cannot restart it and the two
 * machines' clocks never have to agree.
 */
describe("AutoDenyDeadline", () => {
  const frame = {
    type: "permission_request",
    sessionId: "p1",
    requestId: "r1",
    tool: { name: "Bash command", parameters: { text: "touch x" } },
    options: [{ id: "1", label: "Yes", keystroke: "1" }],
    promptKind: "permission",
  };

  test("a countdown on the wire becomes a deadline on this clock", () => {
    expect(pendingFromPermissionRequest({ ...frame, autoDenyMs: 90_000 }, 1_000).deadline).toBe(
      91_000,
    );
  });

  test("no countdown on the wire, no deadline", () => {
    expect("deadline" in pendingFromPermissionRequest(frame, 1_000)).toBe(false);
  });

  test("a closed socket takes the deadline off the card and leaves the card", () => {
    // The server freezes its countdown when the connection closes, so the
    // number the card was showing stops being true at that moment.
    const sockets: Array<{
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      onclose?: () => void;
      send: () => void;
      close: () => void;
    }> = [];
    const realWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class {
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = 0;
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      onclose?: () => void;
      send() {}
      close() {}
      constructor() {
        sockets.push(this);
      }
    } as unknown as typeof WebSocket;
    const internal = wsService as unknown as {
      ws: WebSocket | null;
      socket: WebSocket | null;
      disconnectBannerTimeout: number | null;
    };
    const prevWs = internal.ws;

    try {
      useAppStore.setState({ sessions: new Map(), activeSessionId: null });
      useAppStore.getState().addSession("p1", "/repo", { ready: true });
      wsService.connect();
      const socket = sockets[sockets.length - 1];
      socket.onopen?.();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "event",
          eventId: 1,
          sessionId: "p1",
          payload: { ...frame, autoDenyMs: 90_000 },
        }),
      });
      expect(useAppStore.getState().sessions.get("p1")?.pendingPermission?.deadline).toBeNumber();

      socket.onclose?.();

      const card = useAppStore.getState().sessions.get("p1")?.pendingPermission;
      expect(card?.requestId).toBe("r1");
      expect(card?.deadline).toBeUndefined();
    } finally {
      wsService.destroy();
      if (internal.disconnectBannerTimeout !== null) clearTimeout(internal.disconnectBannerTimeout);
      internal.disconnectBannerTimeout = null;
      internal.ws = prevWs;
      internal.socket = null;
      globalThis.WebSocket = realWebSocket;
    }
  });
});

/**
 * History wording: a question's answer is not an approval. `recordPermissionAction`
 * already accepted "answered"; nothing used to reach it.
 */
describe("permissionResolution", () => {
  const options = [
    { id: "1", label: "A" },
    { id: "2", label: "No thanks" },
  ];

  test("a question's chosen answer is recorded as answered, whatever it says", () => {
    expect(permissionResolution({ promptKind: "question", options }, "1")).toBe("answered");
    // "No thanks" is an answer on a question, not a refusal.
    expect(permissionResolution({ promptKind: "question", options }, "2")).toBe("answered");
  });

  test("cancelling a question is still a refusal", () => {
    expect(permissionResolution({ promptKind: "question", options }, "cancel")).toBe("denied");
  });

  test("a permission prompt keeps the label test it has always used", () => {
    expect(permissionResolution({ promptKind: "permission", options }, "1")).toBe("approved");
    expect(permissionResolution({ promptKind: "permission", options }, "2")).toBe("denied");
    expect(permissionResolution({ options }, "cancel")).toBe("denied");
  });
});

/**
 * The swipe-right shortcut takes the terminal's first option. On the
 * Cancel-only fallback that option is Esc, so "approve" cancelled the prompt.
 */
describe("ApproveNeverCancels", () => {
  const internal = wsService as unknown as { ws: WebSocket | null };
  let prevWs: WebSocket | null;
  const sent: string[] = [];

  beforeEach(() => {
    sent.length = 0;
    prevWs = internal.ws;
    internal.ws = { send: (data: string) => sent.push(data) } as unknown as WebSocket;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("p1", "/repo", { ready: true });
  });

  afterEach(() => {
    internal.ws = prevWs;
  });

  test("approving the Cancel-only fallback sends nothing and keeps the card", () => {
    useAppStore.getState().setPermission("p1", {
      requestId: "r1",
      tool: { name: "Permission required", parameters: { text: "raw screen" } },
      options: [{ id: "cancel", label: "Cancel", keystroke: "esc" }],
    });

    wsService.approvePermission("p1");

    expect(sent).toEqual([]);
    expect(useAppStore.getState().sessions.get("p1")?.pendingPermission?.requestId).toBe("r1");
  });

  test("approving a parsed permission prompt still answers its first option", () => {
    useAppStore.getState().setPermission("p1", {
      requestId: "r2",
      tool: { name: "Bash command", parameters: { text: "touch x" } },
      options: [
        { id: "1", label: "Yes", keystroke: "1" },
        { id: "2", label: "No", keystroke: "2" },
      ],
    });

    wsService.approvePermission("p1");

    expect(sent.map((data) => JSON.parse(data))).toEqual([
      { type: "permission", requestId: "r2", optionId: "1" },
    ]);
  });
});

/**
 * With the page hidden, the prompt is announced by a toast and a local
 * notification before anyone sees the card. They must say what the card says:
 * an unreadable screen claims no kind, so neither may call it a permission.
 */
describe("HiddenPageCopyMatchesTheCard", () => {
  const internal = wsService as unknown as {
    handleMessage: (message: Record<string, unknown>) => void;
  };
  const originalInfo = toastService.info;
  const originalPermission = notificationService.showPermissionNotification;
  const originalQuestion = notificationService.showQuestionNotification;
  const originalUnreadable = notificationService.showUnreadablePromptNotification;
  const originalEnabled = useSettingsStore.getState().notificationsEnabled;
  let toasts: string[];
  let notified: unknown[][];
  let priorHidden: boolean | undefined;

  // lifecycle-manager.test leaves `hidden` behind as a non-configurable own
  // property, which can be assigned but not redefined.
  function setHidden(value: boolean | undefined) {
    const own = Object.getOwnPropertyDescriptor(document, "hidden");
    if (own && !own.configurable) (document as { hidden: boolean | undefined }).hidden = value;
    else if (value === undefined) Reflect.deleteProperty(document, "hidden");
    else Object.defineProperty(document, "hidden", { value, configurable: true });
  }

  beforeEach(() => {
    priorHidden = Object.getOwnPropertyDescriptor(document, "hidden")?.value;
    setHidden(true);
    toasts = [];
    notified = [];
    toastService.info = ((text: string) => {
      toasts.push(text);
      return 0;
    }) as typeof toastService.info;
    notificationService.showPermissionNotification = (async (...args: unknown[]) => {
      notified.push(["permission", ...args]);
    }) as typeof notificationService.showPermissionNotification;
    notificationService.showQuestionNotification = (async (...args: unknown[]) => {
      notified.push(["question", ...args]);
    }) as typeof notificationService.showQuestionNotification;
    notificationService.showUnreadablePromptNotification = (async (...args: unknown[]) => {
      notified.push(["unreadable", ...args]);
    }) as typeof notificationService.showUnreadablePromptNotification;
    useSettingsStore.setState({ notificationsEnabled: true });
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().addSession("p1", "/repo/proj", { ready: true });
  });

  afterEach(() => {
    toastService.info = originalInfo;
    notificationService.showPermissionNotification = originalPermission;
    notificationService.showQuestionNotification = originalQuestion;
    notificationService.showUnreadablePromptNotification = originalUnreadable;
    useSettingsStore.setState({ notificationsEnabled: originalEnabled });
    setHidden(priorHidden);
  });

  test("an unreadable screen is announced in the card's words, not as a permission", () => {
    internal.handleMessage({
      type: "permission_request",
      sessionId: "p1",
      requestId: "r1",
      tool: { name: "Permission required", parameters: { text: "raw screen" } },
      options: [{ id: "cancel", label: "Cancel", keystroke: "esc" }],
    });

    expect(toasts).toEqual(["Can't read this prompt"]);
    expect(notified).toEqual([["unreadable", "p1", "/repo/proj"]]);
  });

  test("a parsed permission prompt is still announced as one", () => {
    internal.handleMessage({
      type: "permission_request",
      sessionId: "p1",
      requestId: "r2",
      tool: { name: "Bash", parameters: { text: "touch x" } },
      options: [
        { id: "1", label: "Yes", keystroke: "1" },
        { id: "2", label: "No", keystroke: "2" },
      ],
      promptKind: "permission",
    });

    expect(toasts).toEqual(["Permission requested: Bash"]);
    expect(notified).toEqual([["permission", "Bash", "p1", "/repo/proj"]]);
  });

  test("a prompt re-sent under the same id refreshes the card without announcing it again", () => {
    const frame = {
      type: "permission_request",
      sessionId: "p1",
      requestId: "r3",
      tool: { name: "Bash", parameters: { text: "touch x" } },
      options: [{ id: "1", label: "Yes", keystroke: "1" }],
      promptKind: "permission",
      autoDenyMs: 90_000,
    };
    internal.handleMessage(frame);
    internal.handleMessage({ ...frame, autoDenyMs: 30_000 });

    expect(toasts).toEqual(["Permission requested: Bash"]);
    expect(notified).toEqual([["permission", "Bash", "p1", "/repo/proj"]]);
    expect(useAppStore.getState().sessions.get("p1")?.pendingPermission?.requestId).toBe("r3");
  });

  test("a new prompt on the same pane is announced", () => {
    const frame = {
      type: "permission_request",
      sessionId: "p1",
      tool: { name: "Bash", parameters: { text: "touch x" } },
      options: [{ id: "1", label: "Yes", keystroke: "1" }],
      promptKind: "permission",
    };
    internal.handleMessage({ ...frame, requestId: "r4" });
    internal.handleMessage({ ...frame, requestId: "r5" });

    expect(toasts).toEqual(["Permission requested: Bash", "Permission requested: Bash"]);
  });
});
