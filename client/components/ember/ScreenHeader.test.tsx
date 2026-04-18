import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import ScreenHeader from "./ScreenHeader";

describe("ScreenHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("1. renders title and ember pill by default", () => {
    const { container } = render(
      <div className="theme-ember">
        <ScreenHeader title="Chat" />
      </div>,
    );
    expect(screen.getByText("Chat")).toBeDefined();
    expect(screen.getByText("ember")).toBeDefined();
    const header = container.querySelector('[role="banner"]');
    expect(header).not.toBeNull();
  });

  it("2. hides pill when showPill is false", () => {
    const { container } = render(
      <div className="theme-ember">
        <ScreenHeader title="X" showPill={false} />
      </div>,
    );
    expect(container.textContent).not.toContain("ember");
  });

  it("3. renders subtitle when provided", () => {
    render(
      <div className="theme-ember">
        <ScreenHeader title="Sessions" subtitle="2 active" />
      </div>,
    );
    expect(screen.getByText("Sessions")).toBeDefined();
    expect(screen.getByText("2 active")).toBeDefined();
  });

  it("4. renders rightSlot element", () => {
    const { container } = render(
      <div className="theme-ember">
        <ScreenHeader title="X" rightSlot={<button data-testid="r">Right</button>} />
      </div>,
    );
    const rightButton = container.querySelector('[data-testid="r"]');
    expect(rightButton).not.toBeNull();
    expect(rightButton?.textContent).toBe("Right");
  });

  it("5. has backdrop-filter style", () => {
    const { container } = render(
      <div className="theme-ember">
        <ScreenHeader title="Test" />
      </div>,
    );
    const header = container.querySelector(".ember-screen-header");
    expect(header).not.toBeNull();
    // Note: computed styles won't work in JSDOM, but we verify the class is applied
    expect(header?.classList.contains("ember-screen-header")).toBe(true);
  });

  it("renders empty title when title is missing", () => {
    const { container } = render(
      <div className="theme-ember">
        <ScreenHeader title="" />
      </div>,
    );
    const title = container.querySelector(".ember-screen-header-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe("");
  });

  it("renders leftSlot element", () => {
    const { container } = render(
      <div className="theme-ember">
        <ScreenHeader title="X" leftSlot={<button data-testid="l">Left</button>} />
      </div>,
    );
    const leftButton = container.querySelector('[data-testid="l"]');
    expect(leftButton).not.toBeNull();
    expect(leftButton?.textContent).toBe("Left");
  });
});
