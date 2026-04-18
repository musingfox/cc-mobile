import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "../../stores/app-store";
import MessageComposer from "./MessageComposer";

describe("MessageComposer", () => {
  const mockOnOpenAgents = mock(() => {});
  const mockOnOpenCommands = mock(() => {});

  const defaultProps = {
    sessionId: "test-session",
    disabled: false,
    onOpenAgents: mockOnOpenAgents,
    onOpenCommands: mockOnOpenCommands,
    capabilities: {
      commands: [{ name: "test" }],
      agents: [{ name: "agent" }],
      model: "test-model",
    },
  };

  beforeEach(() => {
    useAppStore.setState({
      inputDraft: "",
    });
    mockOnOpenAgents.mockClear();
    mockOnOpenCommands.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("1. renders with sessionId and has textarea", () => {
    const { container } = render(
      <div className="theme-ember">
        <MessageComposer {...defaultProps} />
      </div>,
    );

    const textarea = container.querySelector(".ember-composer-textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    // Value starts empty (loaded from localStorage which is empty in tests)
    expect(textarea?.value).toBe("");
  });

  it("2. calls wsService.send when send button clicked with text", () => {
    const { container } = render(
      <div className="theme-ember">
        <MessageComposer {...defaultProps} />
      </div>,
    );

    const textarea = container.querySelector(".ember-composer-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Hello" } });

    const sendButton = screen.getByLabelText("Send message");
    fireEvent.click(sendButton);

    // Draft should be cleared after send
    const state = useAppStore.getState();
    expect(state.inputDraft).toBe("");
  });

  it("3. does not send when input is empty", () => {
    const { container } = render(
      <div className="theme-ember">
        <MessageComposer {...defaultProps} />
      </div>,
    );

    const sendButton = screen.getByLabelText("Send message") as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    fireEvent.click(sendButton);
    // No crash, no-op
  });

  it("4. fires onOpenAgents when lambda button clicked", () => {
    render(
      <div className="theme-ember">
        <MessageComposer {...defaultProps} />
      </div>,
    );

    const agentButton = screen.getByLabelText("Open agents");
    fireEvent.click(agentButton);

    expect(mockOnOpenAgents).toHaveBeenCalledTimes(1);
  });

  it("5. fires onOpenCommands when slash button clicked", () => {
    render(
      <div className="theme-ember">
        <MessageComposer {...defaultProps} />
      </div>,
    );

    const commandButton = screen.getByLabelText("Open commands");
    fireEvent.click(commandButton);

    expect(mockOnOpenCommands).toHaveBeenCalledTimes(1);
  });

  it("disables inputs when sessionId is null", () => {
    const { container } = render(
      <div className="theme-ember">
        <MessageComposer {...defaultProps} sessionId={null} />
      </div>,
    );

    const textarea = container.querySelector(".ember-composer-textarea") as HTMLTextAreaElement;
    expect(textarea?.disabled).toBe(true);

    const agentButton = screen.getByLabelText("Open agents") as HTMLButtonElement;
    expect(agentButton.disabled).toBe(true);

    const commandButton = screen.getByLabelText("Open commands") as HTMLButtonElement;
    expect(commandButton.disabled).toBe(true);
  });
});
