import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import ToolResultCard from "./ToolResultCard";

describe("ToolResultCard", () => {
  const mockOnToggle = mock(() => {});

  it("1. collapsed state does not render body", () => {
    const { container } = render(
      <div className="theme-ember">
        <ToolResultCard
          toolName="Read"
          input={{ file_path: "test.ts" }}
          result="File contents"
          expanded={false}
          onToggle={mockOnToggle}
        />
      </div>,
    );

    const body = container.querySelector(".ember-tool-card-body");
    expect(body).toBeNull();
  });

  it("2. expanded state renders body with result text", () => {
    const { container } = render(
      <div className="theme-ember">
        <ToolResultCard
          toolName="Read"
          input={{ file_path: "test.ts" }}
          result="File contents here"
          expanded={true}
          onToggle={mockOnToggle}
        />
      </div>,
    );

    const body = container.querySelector(".ember-tool-card-body");
    expect(body).not.toBeNull();
    expect(container.textContent).toContain("File contents here");
  });

  it("3. calls onToggle when header clicked", () => {
    mockOnToggle.mockClear();

    const { container } = render(
      <div className="theme-ember">
        <ToolResultCard
          toolName="Read"
          input={{ file_path: "test.ts" }}
          result="File contents"
          expanded={false}
          onToggle={mockOnToggle}
        />
      </div>,
    );

    const header = container.querySelector(".ember-tool-card-header");
    fireEvent.click(header as HTMLElement);

    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it("4. Edit tool uses accent-primary icon color", () => {
    const { container } = render(
      <div className="theme-ember">
        <ToolResultCard
          toolName="Edit"
          input={{ file_path: "test.ts", old_string: "a", new_string: "b" }}
          result=""
          expanded={false}
          onToggle={mockOnToggle}
        />
      </div>,
    );

    const icon = container.querySelector(".ember-tool-card-icon") as HTMLElement;
    expect(icon?.style.color).toBe("var(--accent-primary)");
  });

  it("5. Grep tool uses accent-success icon color", () => {
    const { container } = render(
      <div className="theme-ember">
        <ToolResultCard
          toolName="Grep"
          input={{ pattern: "test" }}
          result="matches"
          expanded={false}
          onToggle={mockOnToggle}
        />
      </div>,
    );

    const icon = container.querySelector(".ember-tool-card-icon") as HTMLElement;
    expect(icon?.style.color).toBe("var(--accent-success)");
  });
});
