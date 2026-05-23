import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import InputBarA from "./InputBarA";

describe("InputBarA", () => {
  const originalSend = wsService.send;
  const originalAppend = wsService.appendUserMessage;

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
    wsService.appendUserMessage = originalAppend;
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

  test("Append button is present and disabled when draft is empty", () => {
    useAppStore.setState({ inputDraft: "" });
    const { container } = render(<InputBarA sessionId="s1" />);
    const appendBtn = container.querySelector('[aria-label="Append note"]');
    expect(appendBtn).not.toBeNull();
    expect((appendBtn as HTMLButtonElement).disabled).toBe(true);
  });

  test("clicking Append calls wsService.appendUserMessage, clears draft, shows '1 note staged'", () => {
    const sendMock = mock(() => {});
    const appendMock = mock(() => {});
    wsService.send = sendMock as typeof wsService.send;
    wsService.appendUserMessage = appendMock as typeof wsService.appendUserMessage;
    useAppStore.setState({ inputDraft: "note one" });

    const { container } = render(<InputBarA sessionId="s1" />);
    const appendBtn = container.querySelector('[aria-label="Append note"]') as HTMLButtonElement;
    expect(appendBtn).not.toBeNull();
    fireEvent.click(appendBtn);

    expect(appendMock).toHaveBeenCalledTimes(1);
    const [arg0, arg1] = appendMock.mock.calls[0];
    expect(arg0).toBe("s1");
    // buildContentBlocks returns a string when no attachments — matches send's shape.
    expect(arg1).toBe("note one");

    expect(sendMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().inputDraft).toBe("");

    const chip = container.querySelector(".lin-input-staged-chip");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("1 note staged");
  });

  test("two clicks of Append → chip shows '2 notes staged · tap Send to ask'", () => {
    const appendMock = mock(() => {});
    wsService.appendUserMessage = appendMock as typeof wsService.appendUserMessage;

    useAppStore.setState({ inputDraft: "n1" });
    const { container } = render(<InputBarA sessionId="s1" />);
    const appendBtn = () =>
      container.querySelector('[aria-label="Append note"]') as HTMLButtonElement;

    act(() => {
      fireEvent.click(appendBtn());
    });
    act(() => {
      useAppStore.setState({ inputDraft: "n2" });
    });
    act(() => {
      fireEvent.click(appendBtn());
    });

    expect(appendMock).toHaveBeenCalledTimes(2);
    const chip = container.querySelector(".lin-input-staged-chip");
    expect(chip).not.toBeNull();
    expect(chip?.textContent ?? "").toContain("2 notes staged · tap Send to ask");
  });

  test("Send after appends clears the chip and resets count", () => {
    const sendMock = mock(() => {});
    const appendMock = mock(() => {});
    wsService.send = sendMock as typeof wsService.send;
    wsService.appendUserMessage = appendMock as typeof wsService.appendUserMessage;

    useAppStore.setState({ inputDraft: "first" });
    const { container } = render(<InputBarA sessionId="s1" />);

    act(() => {
      fireEvent.click(container.querySelector('[aria-label="Append note"]') as HTMLButtonElement);
    });
    act(() => {
      useAppStore.setState({ inputDraft: "second" });
    });
    act(() => {
      fireEvent.click(container.querySelector('[aria-label="Append note"]') as HTMLButtonElement);
    });

    const chip = container.querySelector(".lin-input-staged-chip");
    expect(chip).not.toBeNull();
    expect(chip?.textContent ?? "").toContain("2 notes staged");

    act(() => {
      useAppStore.setState({ inputDraft: "the question" });
    });
    act(() => {
      fireEvent.click(container.querySelector('[aria-label="Send"]') as HTMLButtonElement);
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".lin-input-staged-chip")).toBeNull();
  });

  test("Append button hidden while isStreaming", () => {
    const { container } = render(<InputBarA sessionId="s1" isStreaming />);
    expect(container.querySelector('[aria-label="Append note"]')).toBeNull();
    expect(container.querySelector('[aria-label="Stop"]')).not.toBeNull();
  });

  test("switching sessionId resets the staged chip", () => {
    const appendMock = mock(() => {});
    wsService.appendUserMessage = appendMock as typeof wsService.appendUserMessage;

    useAppStore.setState({ inputDraft: "note" });
    const { container, rerender } = render(<InputBarA sessionId="s1" />);
    fireEvent.click(container.querySelector('[aria-label="Append note"]') as HTMLButtonElement);
    expect(container.querySelector(".lin-input-staged-chip")).not.toBeNull();

    rerender(<InputBarA sessionId="s2" />);
    expect(container.querySelector(".lin-input-staged-chip")).toBeNull();
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
