import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import InputBarA from "./InputBarA";

describe("InputBarA", () => {
  const originalTerminalSend = wsService.terminalSend;

  // Seed a session with a cwd so the send path has everything it needs.
  // `terminal` marks the session as terminal-backed (herdr live session); a
  // session without it is a read-only history view (#25 D1).
  function seed(draft: string, terminal?: { ready: boolean }) {
    useAppStore.setState({
      inputDraft: draft,
      capabilities: null,
      // Only `.cwd` and `.terminal` are read by the component.
      sessions: new Map([["s1", { cwd: "/tmp/proj", terminal }]]) as never,
      activeSessionId: "s1",
    });
  }

  beforeEach(() => {
    seed("", { ready: true });
  });

  afterEach(() => {
    wsService.terminalSend = originalTerminalSend;
    cleanup();
  });

  test("does not send while IME composition is active", () => {
    const terminalMock = mock(() => {});
    wsService.terminalSend = terminalMock as typeof wsService.terminalSend;
    seed("你好", { ready: true });

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea missing");

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true, isComposing: true });

    expect(terminalMock).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().inputDraft).toBe("你好");
  });

  test("does not send when keyCode is 229", () => {
    const terminalMock = mock(() => {});
    wsService.terminalSend = terminalMock as typeof wsService.terminalSend;
    seed("안", { ready: true });

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea missing");

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true, keyCode: 229, which: 229 });

    expect(terminalMock).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().inputDraft).toBe("안");
  });

  test("plain Enter inserts a newline (does NOT send) — multi-line input", () => {
    const terminalMock = mock(() => {});
    wsService.terminalSend = terminalMock as typeof wsService.terminalSend;
    seed("hello", { ready: true });

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea missing");

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false); // browser inserts newline
    expect(terminalMock).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().inputDraft).toBe("hello");
  });

  test("Cmd/Ctrl+Enter sends via terminalSend and clears draft", () => {
    const terminalMock = mock(() => {});
    wsService.terminalSend = terminalMock as typeof wsService.terminalSend;
    seed("hello", { ready: true });

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea missing");

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true, isComposing: false });

    expect(terminalMock).toHaveBeenCalledTimes(1);
    expect(terminalMock).toHaveBeenCalledWith("s1", "hello");
    expect(useAppStore.getState().inputDraft).toBe("");
  });

  test("Send button calls terminalSend with the prompt", () => {
    const terminalMock = mock(() => {});
    wsService.terminalSend = terminalMock as typeof wsService.terminalSend;
    seed("do the thing", { ready: true });

    const { container } = render(<InputBarA sessionId="s1" />);
    fireEvent.click(container.querySelector('[aria-label="Send"]') as HTMLButtonElement);

    expect(terminalMock).toHaveBeenCalledTimes(1);
    expect(terminalMock).toHaveBeenCalledWith("s1", "do the thing");
    expect(useAppStore.getState().inputDraft).toBe("");
  });

  test("terminal session not ready: Send disabled and a click sends nothing", () => {
    const terminalMock = mock(() => {});
    wsService.terminalSend = terminalMock as typeof wsService.terminalSend;
    seed("hello", { ready: false });

    const { container } = render(<InputBarA sessionId="s1" />);
    const send = container.querySelector('[aria-label="Send"]') as HTMLButtonElement;

    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(terminalMock).toHaveBeenCalledTimes(0);
  });

  test("terminal session ready: Send enabled and routes to terminalSend", () => {
    const terminalMock = mock(() => {});
    wsService.terminalSend = terminalMock as typeof wsService.terminalSend;
    seed("hello", { ready: true });

    const { container } = render(<InputBarA sessionId="s1" />);
    const send = container.querySelector('[aria-label="Send"]') as HTMLButtonElement;

    expect(send.disabled).toBe(false);
    fireEvent.click(send);

    expect(terminalMock).toHaveBeenCalledTimes(1);
    expect(terminalMock).toHaveBeenCalledWith("s1", "hello");
  });

  // ── read-only history sessions (#25 D1) ────────────────────────────────────

  test("session without a terminal: send is refused and no message is appended", () => {
    const terminalMock = mock(() => {});
    wsService.terminalSend = terminalMock as typeof wsService.terminalSend;
    seed("hello", undefined);

    const { container } = render(<InputBarA sessionId="s1" />);
    const send = container.querySelector('[aria-label="Send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.click(send);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true, isComposing: false });

    expect(terminalMock).toHaveBeenCalledTimes(0);
    const session = useAppStore.getState().sessions.get("s1") as unknown as {
      messages?: unknown[];
    };
    expect(session.messages ?? []).toHaveLength(0);
  });

  test("session without a terminal: textarea disabled and the read-only reason is shown", () => {
    seed("", undefined);

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;

    expect(textarea.disabled).toBe(true);
    expect(container.textContent).toContain("Read-only view of a past session");
  });

  test("PTY toggle and Append (+) buttons are gone", () => {
    seed("x", { ready: true });
    const { container } = render(<InputBarA sessionId="s1" />);
    expect(container.querySelector('[aria-label="PTY mode"]')).toBeNull();
    expect(container.querySelector('[aria-label="Append note"]')).toBeNull();
  });

  test("Send hidden while streaming; Stop shown", () => {
    seed("x", { ready: true });
    const { container } = render(<InputBarA sessionId="s1" isStreaming />);
    expect(container.querySelector('[aria-label="Send"]')).toBeNull();
    expect(container.querySelector('[aria-label="Stop"]')).not.toBeNull();
  });
});
