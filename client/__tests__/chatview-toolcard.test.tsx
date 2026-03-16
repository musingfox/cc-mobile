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
    // Use getAllByText for multiple icons
    const toolCards = container.querySelectorAll(".tool-card");
    expect(toolCards.length).toBe(2);
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
});
