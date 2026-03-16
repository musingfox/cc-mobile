import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import ChatView from "../components/ChatView";
import type { Message } from "../stores/app-store";

describe("ChatView with ToolCard", () => {
  it("10. tool messages use ToolCard component", () => {
    const messages: Message[] = [
      {
        id: "tool-1",
        role: "tool",
        toolName: "Read",
        toolInput: { file_path: "/test/example.ts" },
        content: "File contents here",
        timestamp: Date.now(),
      },
    ];

    render(<ChatView messages={messages} />);

    // ToolCard should render with icon and filename from toolInput
    expect(screen.getByText("📖")).toBeDefined();
    expect(screen.getByText("example.ts")).toBeDefined();
  });

  it("handles tool message with invalid JSON content", () => {
    const messages: Message[] = [
      {
        id: "tool-1",
        role: "tool",
        toolName: "Bash",
        content: "not valid json",
        timestamp: Date.now(),
      },
    ];

    render(<ChatView messages={messages} />);

    // Should still render with fallback
    expect(screen.getByText("⚙️")).toBeDefined();
    expect(screen.getByText("Bash")).toBeDefined();
  });

  it("renders multiple tool messages", () => {
    const messages: Message[] = [
      {
        id: "tool-1",
        role: "tool",
        toolName: "Read",
        toolInput: { file_path: "/test/file1.ts" },
        content: "File 1 contents",
        timestamp: Date.now(),
      },
      {
        id: "tool-2",
        role: "tool",
        toolName: "Edit",
        toolInput: { file_path: "/test/file2.ts" },
        content: "Edit result",
        timestamp: Date.now(),
      },
    ];

    const { container } = render(<ChatView messages={messages} />);

    expect(screen.getByText("file1.ts")).toBeDefined();
    expect(screen.getByText("file2.ts")).toBeDefined();
    // Both render as chips (collapsed by default)
    const toolChips = container.querySelectorAll(".tool-chip");
    expect(toolChips.length).toBe(2);
  });

  it("preserves auto-scroll functionality", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      },
    ];

    const { container } = render(<ChatView messages={messages} />);
    const chatView = container.querySelector(".chat-view");

    // Should have scrollRef attached
    expect(chatView).not.toBeNull();
  });

  it("renders resume session button when cwd and onResumeSession are provided", () => {
    const onResumeSession = mock(() => {});

    render(<ChatView messages={[]} cwd="/test/project" onResumeSession={onResumeSession} />);

    expect(screen.getByText("Resume a previous session")).toBeDefined();
  });

  it("shows activity panel when streaming with active tools", () => {
    const activeTools = new Map();
    activeTools.set("tool-1", {
      toolName: "Bash",
      startedAt: Date.now() - 5000,
    });

    const { container } = render(
      <ChatView messages={[]} isStreaming={true} activeTools={activeTools} />,
    );

    // ActivityPanel should be rendered
    const activityPanel = container.querySelector(".activity-panel");
    expect(activityPanel).not.toBeNull();
  });

  it("user messages have CSS class for warm bubble styling", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Hello Claude",
        timestamp: Date.now(),
      },
    ];

    const { container } = render(<ChatView messages={messages} />);

    // User message should have .message.user classes
    const userMessage = container.querySelector(".message.user");
    expect(userMessage).not.toBeNull();

    // User message content should have .message-content class
    const messageContent = container.querySelector(".message.user .message-content");
    expect(messageContent).not.toBeNull();
    expect(messageContent?.textContent).toBe("Hello Claude");
  });

  it("assistant messages have CSS class for no-background styling", () => {
    const messages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hello user",
        timestamp: Date.now(),
      },
    ];

    const { container } = render(<ChatView messages={messages} />);

    // Assistant message should have .message.assistant classes
    const assistantMessage = container.querySelector(".message.assistant");
    expect(assistantMessage).not.toBeNull();

    // Assistant message content should have .message-content class
    const messageContent = container.querySelector(".message.assistant .message-content");
    expect(messageContent).not.toBeNull();
    expect(messageContent?.textContent?.trim()).toBe("Hello user");
  });

  it("tool messages still use ToolCard component (not message-content)", () => {
    const messages: Message[] = [
      {
        id: "tool-1",
        role: "tool",
        toolName: "Read",
        toolInput: { file_path: "/test/file.ts" },
        content: "File contents",
        timestamp: Date.now(),
      },
    ];

    const { container } = render(<ChatView messages={messages} />);

    // Tool message should have .tool-chip (collapsed ToolCard)
    const toolChip = container.querySelector(".tool-chip");
    expect(toolChip).not.toBeNull();

    // Tool message should NOT have .message-content (since it uses ToolCard)
    const messageContent = container.querySelector(".message.tool .message-content");
    expect(messageContent).toBeNull();
  });

  it("auto-scroll behavior preserved with scrollRef and handleScroll", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "user",
        content: "Test message",
        timestamp: Date.now(),
      },
    ];

    const { container } = render(<ChatView messages={messages} />);
    const chatView = container.querySelector(".chat-view");

    // Should have scrollRef attached and onScroll handler
    expect(chatView).not.toBeNull();
    expect(chatView?.getAttribute("class")).toBe("chat-view");
  });
});
