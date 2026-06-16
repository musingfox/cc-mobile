import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import InputBarA from "./InputBarA";

describe("InputBarA", () => {
  const originalPtySend = wsService.ptySend;

  // Seed a session with a cwd so the PTY send path has everything it needs.
  function seed(draft: string) {
    useAppStore.setState({
      inputDraft: draft,
      capabilities: null,
      // Only `.cwd` is read by the component.
      sessions: new Map([["s1", { cwd: "/tmp/proj" }]]) as never,
      activeSessionId: "s1",
    });
  }

  beforeEach(() => {
    seed("");
  });

  afterEach(() => {
    wsService.ptySend = originalPtySend;
    cleanup();
  });

  test("does not send while IME composition is active", () => {
    const ptyMock = mock(() => {});
    wsService.ptySend = ptyMock as typeof wsService.ptySend;
    seed("你好");

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea missing");

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true, isComposing: true });

    expect(ptyMock).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().inputDraft).toBe("你好");
  });

  test("does not send when keyCode is 229", () => {
    const ptyMock = mock(() => {});
    wsService.ptySend = ptyMock as typeof wsService.ptySend;
    seed("안");

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea missing");

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true, keyCode: 229, which: 229 });

    expect(ptyMock).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().inputDraft).toBe("안");
  });

  test("plain Enter inserts a newline (does NOT send) — multi-line input", () => {
    const ptyMock = mock(() => {});
    wsService.ptySend = ptyMock as typeof wsService.ptySend;
    seed("hello");

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
    expect(ptyMock).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().inputDraft).toBe("hello");
  });

  test("Cmd/Ctrl+Enter sends via ptySend and clears draft", () => {
    const ptyMock = mock(() => {});
    wsService.ptySend = ptyMock as typeof wsService.ptySend;
    seed("hello");

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea missing");

    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true, isComposing: false });

    expect(ptyMock).toHaveBeenCalledTimes(1);
    expect(ptyMock).toHaveBeenCalledWith("s1", "/tmp/proj", "hello");
    expect(useAppStore.getState().inputDraft).toBe("");
  });

  test("Send button calls ptySend with session cwd + prompt", () => {
    const ptyMock = mock(() => {});
    wsService.ptySend = ptyMock as typeof wsService.ptySend;
    seed("do the thing");

    const { container } = render(<InputBarA sessionId="s1" />);
    fireEvent.click(container.querySelector('[aria-label="Send"]') as HTMLButtonElement);

    expect(ptyMock).toHaveBeenCalledTimes(1);
    expect(ptyMock).toHaveBeenCalledWith("s1", "/tmp/proj", "do the thing");
    expect(useAppStore.getState().inputDraft).toBe("");
  });

  test("PTY toggle and Append (+) buttons are gone", () => {
    seed("x");
    const { container } = render(<InputBarA sessionId="s1" />);
    expect(container.querySelector('[aria-label="PTY mode"]')).toBeNull();
    expect(container.querySelector('[aria-label="Append note"]')).toBeNull();
  });

  test("Send hidden while streaming; Stop shown", () => {
    seed("x");
    const { container } = render(<InputBarA sessionId="s1" isStreaming />);
    expect(container.querySelector('[aria-label="Send"]')).toBeNull();
    expect(container.querySelector('[aria-label="Stop"]')).not.toBeNull();
  });
});
