import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import ToolCard from "./ToolCard";

describe("ToolCard", () => {
  it("7. renders with collapsed state showing only header", () => {
    const onToggle = mock(() => {});
    const { container } = render(
      <ToolCard
        toolName="Read"
        input={{ file_path: "/test/file.txt" }}
        content="File content here"
        expanded={false}
        onToggle={onToggle}
      />,
    );

    // Header should be visible
    expect(screen.getByText("file.txt")).toBeDefined();
    expect(screen.getByText("📖")).toBeDefined();

    // Content should not be visible
    expect(container.querySelector(".tool-card-content")).toBeNull();
  });

  it("8. renders with expanded state showing content", () => {
    const onToggle = mock(() => {});
    const { container } = render(
      <ToolCard
        toolName="Read"
        input={{ file_path: "/test/file.txt" }}
        content="File content here"
        expanded={true}
        onToggle={onToggle}
      />,
    );

    // Header should be visible
    expect(screen.getByText("file.txt")).toBeDefined();

    // Content should be visible
    const content = container.querySelector(".tool-card-content");
    expect(content).not.toBeNull();
    expect(screen.getByText("File content here")).toBeDefined();
  });

  it("9. shows elapsed timer when isRunning is true", () => {
    const onToggle = mock(() => {});
    render(
      <ToolCard
        toolName="Bash"
        input={{ command: "npm install" }}
        content=""
        elapsedSeconds={5}
        isRunning={true}
        expanded={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("5s")).toBeDefined();
    expect(screen.getByText("⏳")).toBeDefined();
  });

  it("shows spinner when isRunning is true", () => {
    const onToggle = mock(() => {});
    render(
      <ToolCard
        toolName="Bash"
        input={{ command: "npm install" }}
        content=""
        isRunning={true}
        expanded={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("⏳")).toBeDefined();
  });

  it("does not show elapsed timer when isRunning is false", () => {
    const onToggle = mock(() => {});
    const { container } = render(
      <ToolCard
        toolName="Bash"
        input={{ command: "npm install" }}
        content=""
        elapsedSeconds={5}
        isRunning={false}
        expanded={false}
        onToggle={onToggle}
      />,
    );

    expect(container.querySelector(".tool-card-elapsed")).toBeNull();
    expect(container.querySelector(".tool-card-spinner")).toBeNull();
  });

  it("formats elapsed time correctly (minutes and seconds)", () => {
    const onToggle = mock(() => {});
    render(
      <ToolCard
        toolName="Bash"
        input={{ command: "long task" }}
        content=""
        elapsedSeconds={125}
        isRunning={true}
        expanded={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("2m 5s")).toBeDefined();
  });

  it("uses generic icon for unknown tool", () => {
    const onToggle = mock(() => {});
    render(
      <ToolCard
        toolName="UnknownTool"
        input={{}}
        content=""
        expanded={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("🔧")).toBeDefined();
    expect(screen.getByText("UnknownTool")).toBeDefined();
  });

  it("renders children in content area when expanded", () => {
    const onToggle = mock(() => {});
    render(
      <ToolCard
        toolName="Read"
        input={{ file_path: "/test/file.txt" }}
        content="File content"
        expanded={true}
        onToggle={onToggle}
      >
        <div className="permission-footer">Permission required</div>
      </ToolCard>,
    );

    expect(screen.getByText("Permission required")).toBeDefined();
  });

  it("uses Bash description for title", () => {
    const onToggle = mock(() => {});
    render(
      <ToolCard
        toolName="Bash"
        input={{ description: "Install dependencies", command: "npm install" }}
        content=""
        expanded={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("Install dependencies")).toBeDefined();
  });

  it("uses collapse icon when expanded", () => {
    const onToggle = mock(() => {});
    render(
      <ToolCard
        toolName="Read"
        input={{ file_path: "/test/file.txt" }}
        content=""
        expanded={true}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("▼")).toBeDefined();
  });

  it("uses expand icon when collapsed", () => {
    const onToggle = mock(() => {});
    render(
      <ToolCard
        toolName="Read"
        input={{ file_path: "/test/file.txt" }}
        content=""
        expanded={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText("▶")).toBeDefined();
  });

  it("8. Edit tool with toolInput renders DiffView collapsed", () => {
    const onToggle = mock(() => {});
    const { container } = render(
      <ToolCard
        toolName="Edit"
        input={{
          file_path: "/test/file.txt",
          old_string: "hello world",
          new_string: "hello earth",
        }}
        content=""
        expanded={true}
        onToggle={onToggle}
      />,
    );

    // Should render DiffView
    expect(container.querySelector(".diff-view")).not.toBeNull();

    // DiffView should be collapsed by default
    expect(container.querySelector(".diff-view-content")).toBeNull();

    // Should show change counts
    expect(screen.getByText("+1")).toBeDefined();
    expect(screen.getByText("-1")).toBeDefined();
  });

  it("9. non-edit tool renders plain content", () => {
    const onToggle = mock(() => {});
    const content = `file1.txt
file2.txt`;
    const { container } = render(
      <ToolCard
        toolName="Bash"
        input={{ command: "ls -la" }}
        content={content}
        expanded={true}
        onToggle={onToggle}
      />,
    );

    // Should NOT render DiffView
    expect(container.querySelector(".diff-view")).toBeNull();

    // Should render plain content
    const output = container.querySelector(".tool-card-output");
    expect(output).not.toBeNull();
    expect(output?.textContent).toContain("file1.txt");
    expect(output?.textContent).toContain("file2.txt");
  });
});
