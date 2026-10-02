import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import ChatScreen from "../components/linear/ChatScreen";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

/**
 * A send from the phone raises the spinner before herdr has said anything, and
 * herdr may never say anything: a quick turn can read idle on both samples, so
 * no session_state answers it. The settle's stream_end has to bring Send back.
 */

const internal = wsService as unknown as {
  ws: unknown;
  handleMessage: (message: Record<string, unknown>) => void;
};

function deliver(message: Record<string, unknown>) {
  act(() => internal.handleMessage(message));
}

function settle() {
  deliver({
    type: "stream_chunk",
    sessionId: "p1",
    chunk: {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      recordId: "a1",
      seq: 9,
      epoch: "aaaa",
    },
  });
  deliver({ type: "stream_end", sessionId: "p1" });
}

function button(container: HTMLElement) {
  if (container.querySelector('[aria-label="Stop"]')) return "Stop";
  if (container.querySelector('[aria-label="Send"]')) return "Send";
  return null;
}

describe("OptimisticSpinnerComesDown", () => {
  let previousWs: unknown;

  beforeEach(() => {
    previousWs = internal.ws;
    internal.ws = { send: () => {} };
    localStorage.clear();
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
    useAppStore.getState().addSession("p1", "/repo/proj", { ready: true });
  });

  afterEach(() => {
    internal.ws = previousWs;
    cleanup();
    localStorage.clear();
  });

  test("idle before the send, no running ever arrives, stream_end: Send is back", () => {
    useAppStore.getState().setAgentState("p1", "idle");
    const { container } = render(<ChatScreen onNavigate={() => {}} />);

    act(() => wsService.terminalSend("p1", "quick one"));
    expect(button(container)).toBe("Stop");

    settle();

    expect(button(container)).toBe("Send");
    expect(container.querySelector(".lin-thinking")).toBeNull();
  });

  test("no session_state at all, stream_end: Send is back", () => {
    const { container } = render(<ChatScreen onNavigate={() => {}} />);

    act(() => wsService.terminalSend("p1", "quick one"));
    settle();

    expect(button(container)).toBe("Send");
  });

  test("while session_state says running, a stream_end leaves the turn running", () => {
    const { container } = render(<ChatScreen onNavigate={() => {}} />);

    act(() => wsService.terminalSend("p1", "long one"));
    deliver({ type: "session_state", sessionId: "p1", state: "running" });
    settle();

    expect(button(container)).toBe("Stop");
  });
});
