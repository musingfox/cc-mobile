import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import BottomSheet from "./BottomSheet";

describe("BottomSheet", () => {
  test("renders overlay and sheet with content when open", () => {
    const onClose = mock(() => {});
    const { container, getByTestId } = render(
      <div className="theme-ember">
        <BottomSheet open={true} onClose={onClose} title="Agents">
          <div data-testid="sheet-content">Test Content</div>
        </BottomSheet>
      </div>,
    );

    const overlay = container.querySelector(".ember-bottom-sheet-overlay");
    const sheet = container.querySelector(".ember-bottom-sheet");
    const content = getByTestId("sheet-content");

    expect(overlay).toBeDefined();
    expect(sheet).toBeDefined();
    expect(content).toBeDefined();
    expect(content.textContent).toBe("Test Content");
  });

  test("clicking overlay calls onClose", () => {
    const onClose = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomSheet open={true} onClose={onClose} title="Test">
          <div>Content</div>
        </BottomSheet>
      </div>,
    );

    const overlay = container.querySelector(".ember-bottom-sheet-overlay") as HTMLElement;
    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("clicking inside sheet does not call onClose", () => {
    const onClose = mock(() => {});
    const { getByTestId } = render(
      <div className="theme-ember">
        <BottomSheet open={true} onClose={onClose} title="Test">
          <div data-testid="inner-content">Content</div>
        </BottomSheet>
      </div>,
    );

    const innerContent = getByTestId("inner-content");
    fireEvent.click(innerContent);

    expect(onClose).not.toHaveBeenCalled();
  });

  test("sheet is not rendered when open is false", () => {
    const onClose = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomSheet open={false} onClose={onClose} title="Test">
          <div>Content</div>
        </BottomSheet>
      </div>,
    );

    // Should not be rendered when open=false
    const overlay = container.querySelector(".ember-bottom-sheet-overlay");
    const sheet = container.querySelector(".ember-bottom-sheet");
    expect(overlay).toBeNull();
    expect(sheet).toBeNull();
  });

  test("sheet has dialog role and aria-modal", () => {
    const onClose = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomSheet open={true} onClose={onClose} title="Test">
          <div>Content</div>
        </BottomSheet>
      </div>,
    );

    const sheet = container.querySelector(".ember-bottom-sheet") as HTMLElement;
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
  });

  test("title is rendered when provided", () => {
    const onClose = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomSheet open={true} onClose={onClose} title="My Title">
          <div>Content</div>
        </BottomSheet>
      </div>,
    );

    const title = container.querySelector(".ember-bottom-sheet-title") as HTMLElement;
    expect(title).toBeDefined();
    expect(title.textContent).toBe("My Title");
  });

  test("handle is rendered", () => {
    const onClose = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomSheet open={true} onClose={onClose}>
          <div>Content</div>
        </BottomSheet>
      </div>,
    );

    const handle = container.querySelector(".ember-bottom-sheet-handle");
    expect(handle).toBeDefined();
  });
});
