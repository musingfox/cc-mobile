import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import InputBar from "./InputBar";

describe("InputBar attachment integration", () => {
  const defaultProps = {
    onSend: mock(() => {}),
    disabled: false,
    capabilities: {
      commands: ["test"],
      agents: ["agent"],
      model: "test-model",
    },
    onOpenCommandPanel: mock(() => {}),
    onOpenAgentPanel: mock(() => {}),
    activeSessionId: "test-session",
  };

  test("C5: attachment button is present", () => {
    render(<InputBar {...defaultProps} />);
    const attachButton = screen.getByLabelText("Attach file or image");
    expect(attachButton).toBeDefined();
  });

  test("send button is enabled when text is present", () => {
    render(<InputBar {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    const sendBtn = screen.getByLabelText("Send message") as HTMLButtonElement;

    expect(sendBtn.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "test message" } });
    expect(sendBtn.disabled).toBe(false);
  });

  test("attachment button is disabled when input is disabled", () => {
    render(<InputBar {...defaultProps} disabled={true} />);
    const attachButton = screen.getByLabelText("Attach file or image") as HTMLButtonElement;
    expect(attachButton.disabled).toBe(true);
  });
});
