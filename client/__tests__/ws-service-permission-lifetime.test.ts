import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * A prompt card lives exactly as long as its pane is waiting on it.
 *
 * Audit 2026-10-03 #3: a question answered at the terminal kept its card on
 * the phone (the pane was idle), a permission card sat on a running pane, and
 * a reconnect replayed old prompts whose later state changes did not remove
 * them — `session_state` moved the dot and left the card.
 */

function getInternal() {
  return wsService as unknown as {
    handleMessage: (msg: Record<string, unknown>) => void;
    rememberCardsAtOpen: () => void;
  };
}

const PANE = "wHY:p1";

function request(requestId: string): Record<string, unknown> {
  return {
    type: "permission_request",
    sessionId: PANE,
    requestId,
    tool: { name: "A 或 B", parameters: { text: "這次要選 A 還是 B？" } },
    options: [
      { id: "1", label: "A", keystroke: "1" },
      { id: "2", label: "B", keystroke: "2" },
    ],
    promptKind: "question",
  };
}

function listing(state: string): Record<string, unknown> {
  return {
    type: "terminal_sessions",
    sessions: [
      {
        sessionId: PANE,
        cwd: "/repo",
        origin: "foreign",
        drivable: true,
        readable: true,
        gated: true,
        state,
      },
    ],
  };
}

const card = () => useAppStore.getState().sessions.get(PANE)?.pendingPermission ?? null;

describe("PromptCardLifetime", () => {
  const originalInfo = toastService.info;

  beforeEach(() => {
    toastService.info = (() => 0) as typeof toastService.info;
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
    useAppStore.getState().upsertListedSession({
      sessionId: PANE,
      cwd: "/repo",
      origin: "foreign",
      drivable: true,
      readable: true,
      gated: true,
    });
  });

  afterEach(() => {
    toastService.info = originalInfo;
  });

  test("a pane that goes back to work takes its card with it", () => {
    getInternal().handleMessage({
      type: "session_state",
      sessionId: PANE,
      state: "requires_action",
    });
    getInternal().handleMessage(request("r1"));
    expect(card()?.requestId).toBe("r1");

    getInternal().handleMessage({ type: "session_state", sessionId: PANE, state: "running" });

    expect(card()).toBeNull();
  });

  test("a pane that settles takes its card with it", () => {
    getInternal().handleMessage(request("r1"));

    getInternal().handleMessage({ type: "session_state", sessionId: PANE, state: "idle" });

    expect(card()).toBeNull();
  });

  test("a replay of a prompt and the state that followed it ends with no card", () => {
    // What a reconnect re-delivers, in buffer order.
    for (const frame of [
      { type: "session_state", sessionId: PANE, state: "requires_action" },
      request("r1"),
      { type: "session_state", sessionId: PANE, state: "running" },
      { type: "session_state", sessionId: PANE, state: "idle" },
    ]) {
      getInternal().handleMessage(frame);
    }

    expect(card()).toBeNull();
  });

  test("a waiting pane keeps its card", () => {
    getInternal().handleMessage(request("r1"));

    getInternal().handleMessage({
      type: "session_state",
      sessionId: PANE,
      state: "requires_action",
    });
    getInternal().handleMessage(listing("requires_action"));

    expect(card()?.requestId).toBe("r1");
  });

  test("the listing's idle clears a card the phone was still holding", () => {
    getInternal().handleMessage(request("r1"));
    getInternal().rememberCardsAtOpen();

    getInternal().handleMessage(listing("idle"));

    expect(card()).toBeNull();
  });

  test("the listing's running clears a card held from before this connection", () => {
    // Answered at the terminal while the phone was away: no sink was bound,
    // so the state change that would have cleared it was never sent.
    getInternal().handleMessage(request("r1"));
    getInternal().rememberCardsAtOpen();

    getInternal().handleMessage(listing("running"));

    expect(card()).toBeNull();
  });

  test("the listing's running does not clear a card raised on this connection", () => {
    // The listing's state is read before the sinks are bound, so a prompt that
    // appears while it is being assembled arrives first and its state is older.
    getInternal().rememberCardsAtOpen();
    getInternal().handleMessage(request("r2"));

    getInternal().handleMessage(listing("running"));

    expect(card()?.requestId).toBe("r2");
  });
});
