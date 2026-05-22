import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import InputBarA from "./InputBarA";

describe("InputBarA", () => {
  const originalSend = wsService.send;

  beforeEach(() => {
    useAppStore.setState({
      inputDraft: "",
      capabilities: null,
      sessions: new Map(),
      activeSessionId: null,
    });
  });

  afterEach(() => {
    wsService.send = originalSend;
    cleanup();
  });

  test("does not send while IME composition is active", () => {
    const sendMock = mock(() => {});
    wsService.send = sendMock as typeof wsService.send;
    useAppStore.setState({ inputDraft: "你好" });

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    if (!textarea) throw new Error("textarea missing");

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false, isComposing: true });

    expect(sendMock).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().inputDraft).toBe("你好");
  });

  test("does not send when keyCode is 229", () => {
    const sendMock = mock(() => {});
    wsService.send = sendMock as typeof wsService.send;
    useAppStore.setState({ inputDraft: "안" });

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    if (!textarea) throw new Error("textarea missing");

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false, keyCode: 229, which: 229 });

    expect(sendMock).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().inputDraft).toBe("안");
  });

  test("sends and clears draft on Enter when not composing", () => {
    const sendMock = mock(() => {});
    wsService.send = sendMock as typeof wsService.send;
    useAppStore.setState({ inputDraft: "hello" });

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    if (!textarea) throw new Error("textarea missing");

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false, isComposing: false });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("s1", "hello");
    expect(useAppStore.getState().inputDraft).toBe("");
  });

  test("Shift+Enter does not prevent default and does not send", () => {
    const sendMock = mock(() => {});
    wsService.send = sendMock as typeof wsService.send;
    useAppStore.setState({ inputDraft: "line" });

    const { container } = render(<InputBarA sessionId="s1" />);
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    if (!textarea) throw new Error("textarea missing");

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(0);
  });
});
