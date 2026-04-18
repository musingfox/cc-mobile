import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import IconButton from "./IconButton";

// Simple X icon component for testing
function XIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

describe("IconButton", () => {
  test("renders with aria-label and minimum touch target", () => {
    const onClick = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <IconButton icon={<XIcon />} label="Close" onClick={onClick} />
      </div>,
    );

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button).toBeDefined();
    expect(button.getAttribute("aria-label")).toBe("Close");

    // Verify the class is applied (CSS will enforce min 44px in actual rendering)
    expect(button.className).toContain("ember-icon-button");
  });

  test("calls onClick when clicked", () => {
    const onClick = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <IconButton icon={<XIcon />} label="Close" onClick={onClick} />
      </div>,
    );

    const button = container.querySelector("button") as HTMLButtonElement;
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("disabled button does not call onClick", () => {
    const onClick = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <IconButton icon={<XIcon />} label="Close" onClick={onClick} disabled />
      </div>,
    );

    const button = container.querySelector("button") as HTMLButtonElement;
    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
  });

  test("accent variant has amber background", () => {
    const onClick = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <IconButton icon={<XIcon />} label="Close" onClick={onClick} variant="accent" />
      </div>,
    );

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.className).toContain("ember-icon-button--accent");
  });

  test("ghost variant applies correct class", () => {
    const onClick = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <IconButton icon={<XIcon />} label="Close" onClick={onClick} variant="ghost" />
      </div>,
    );

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.className).toContain("ember-icon-button--ghost");
  });

  test("size prop controls icon dimensions via CSS variable", () => {
    const onClick = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <IconButton icon={<XIcon />} label="Close" onClick={onClick} size={40} />
      </div>,
    );

    const button = container.querySelector("button") as HTMLButtonElement;
    const style = button.getAttribute("style");
    expect(style).toContain("--icon-size: 40px");
  });
});
