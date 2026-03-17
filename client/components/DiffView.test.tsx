import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import DiffView from "./DiffView";

describe("DiffView", () => {
  afterEach(() => {
    cleanup();
  });
  it("5. collapsed shows summary with change counts", () => {
    const onToggle = mock(() => {});
    const { container } = render(
      <DiffView
        oldString="line1\nline2\nline3"
        newString="line1\nmodified\nline3"
        filePath="/test/file.txt"
        collapsed={true}
        onToggle={onToggle}
      />,
    );

    // Should show file path
    expect(screen.getByText("/test/file.txt")).toBeDefined();

    // Should show change counts
    expect(screen.getByText("+1")).toBeDefined();
    expect(screen.getByText("-1")).toBeDefined();

    // Should show expand icon
    expect(screen.getByText("▶")).toBeDefined();

    // Should not show diff content
    expect(container.querySelector(".diff-view-content")).toBeNull();
  });

  it("6. expanded shows diff lines with colors", () => {
    const onToggle = mock(() => {});
    const { container } = render(
      <DiffView oldString="old line" newString="new line" collapsed={false} onToggle={onToggle} />,
    );

    // Should show collapse icon
    expect(screen.getByText("▼")).toBeDefined();

    // Should show diff content
    expect(container.querySelector(".diff-view-content")).not.toBeNull();

    // Should have diff lines
    const diffLines = container.querySelectorAll(".diff-line");
    expect(diffLines.length).toBeGreaterThan(0);

    // Should have remove and add lines
    expect(container.querySelector(".diff-line-remove")).not.toBeNull();
    expect(container.querySelector(".diff-line-add")).not.toBeNull();
  });

  it("7. leading spaces shown as middledot", () => {
    const onToggle = mock(() => {});
    render(
      <DiffView
        oldString="  indented line"
        newString="  indented line"
        collapsed={false}
        onToggle={onToggle}
      />,
    );

    // The leading spaces should be replaced with middledots
    // We can check for the middledot character in the rendered content
    const content = screen.getByText(/··indented line/);
    expect(content).toBeDefined();
  });

  it("handles new file (all additions)", () => {
    const onToggle = mock(() => {});
    const newContent = `line1
line2
line3`;
    const { container } = render(
      <DiffView
        oldString=""
        newString={newContent}
        filePath="/new/file.txt"
        collapsed={false}
        onToggle={onToggle}
      />,
    );

    // Should show 3 additions (rendered as separate elements)
    const stats = container.querySelector(".diff-view-stats");
    expect(stats?.textContent).toContain("+3");
    expect(stats?.textContent).toContain("-0");

    // All lines should be add type
    const diffLines = container.querySelectorAll(".diff-line");
    expect(diffLines.length).toBe(3);

    for (const line of diffLines) {
      expect(line.classList.contains("diff-line-add")).toBe(true);
    }
  });

  it("handles file deletion (all removals)", () => {
    const onToggle = mock(() => {});
    const oldContent = `line1
line2
line3`;
    const { container } = render(
      <DiffView
        oldString={oldContent}
        newString=""
        filePath="/deleted/file.txt"
        collapsed={false}
        onToggle={onToggle}
      />,
    );

    // Should show 3 removals (rendered as separate elements)
    const stats = container.querySelector(".diff-view-stats");
    expect(stats?.textContent).toContain("+0");
    expect(stats?.textContent).toContain("-3");

    // All lines should be remove type
    const diffLines = container.querySelectorAll(".diff-line");
    expect(diffLines.length).toBe(3);

    for (const line of diffLines) {
      expect(line.classList.contains("diff-line-remove")).toBe(true);
    }
  });

  it("shows line numbers for context, add, and remove lines", () => {
    const onToggle = mock(() => {});
    const oldContent = `line1
line2
line3`;
    const newContent = `line1
modified
line3`;
    const { container } = render(
      <DiffView
        oldString={oldContent}
        newString={newContent}
        collapsed={false}
        onToggle={onToggle}
      />,
    );

    const lineNums = container.querySelectorAll(".diff-line-num");
    expect(lineNums.length).toBeGreaterThan(0);

    // Check that line numbers are rendered (check concatenated content)
    const lineNumsText = Array.from(lineNums)
      .map((el) => el.textContent)
      .join(" ");
    expect(lineNumsText).toContain("1");
    expect(lineNumsText).toContain("2");
    expect(lineNumsText).toContain("3");
  });

  it("shows prefix characters (+, -, space)", () => {
    const onToggle = mock(() => {});
    const oldContent = `line1
line2`;
    const newContent = `line1
modified`;
    const { container } = render(
      <DiffView
        oldString={oldContent}
        newString={newContent}
        collapsed={false}
        onToggle={onToggle}
      />,
    );

    const prefixes = container.querySelectorAll(".diff-line-prefix");
    const prefixTexts = Array.from(prefixes).map((el) => el.textContent || "");

    // Should have space for context, - for remove, + for add
    // Context lines have a single space character as prefix
    expect(prefixTexts.some((text) => text.trim() === "")).toBe(true); // context
    expect(prefixTexts.includes("-")).toBe(true); // remove
    expect(prefixTexts.includes("+")).toBe(true); // add
  });

  it("renders without file path", () => {
    const onToggle = mock(() => {});
    const { container } = render(
      <DiffView oldString="old" newString="new" collapsed={true} onToggle={onToggle} />,
    );

    // Should not show file path element when undefined
    expect(container.querySelector(".diff-view-file-path")).toBeNull();
  });

  it("renders highlights for character-level changes", () => {
    const onToggle = mock(() => {});
    const { container } = render(
      <DiffView
        oldString="hello world"
        newString="hello earth"
        collapsed={false}
        onToggle={onToggle}
      />,
    );

    // Should have highlight elements
    const highlights = container.querySelectorAll(".diff-highlight");
    expect(highlights.length).toBeGreaterThan(0);
  });
});
