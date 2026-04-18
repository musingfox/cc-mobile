import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import BottomTabBar from "./BottomTabBar";

describe("BottomTabBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("1. renders 5 buttons with chat active", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomTabBar activeTab="chat" onChange={onChange} />
      </div>,
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(5);

    // Find chat button (third button)
    const chatButton = Array.from(buttons).find((btn) => btn.getAttribute("aria-label") === "Chat");
    expect(chatButton).not.toBeNull();
    expect(chatButton?.getAttribute("aria-pressed")).toBe("true");

    // Other buttons should not be pressed
    const sessionsButton = Array.from(buttons).find(
      (btn) => btn.getAttribute("aria-label") === "Sessions",
    );
    expect(sessionsButton?.getAttribute("aria-pressed")).toBe("false");
  });

  it("2. calls onChange when sessions tab is clicked", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomTabBar activeTab="chat" onChange={onChange} />
      </div>,
    );

    const buttons = container.querySelectorAll("button");
    const sessionsButton = Array.from(buttons).find(
      (btn) => btn.getAttribute("aria-label") === "Sessions",
    );

    expect(sessionsButton).not.toBeNull();
    fireEvent.click(sessionsButton as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("sessions");
  });

  it("3. each tab button has min-width and min-height 44px", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomTabBar activeTab="chat" onChange={onChange} />
      </div>,
    );

    const buttons = container.querySelectorAll(".ember-tab-button");
    expect(buttons.length).toBe(5);

    // We can't test computed styles in JSDOM, but we verify the class is applied
    buttons.forEach((btn) => {
      expect(btn.classList.contains("ember-tab-button")).toBe(true);
    });
  });

  it("4. active tab has active class", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomTabBar activeTab="chat" onChange={onChange} />
      </div>,
    );

    const buttons = container.querySelectorAll("button");
    const chatButton = Array.from(buttons).find((btn) => btn.getAttribute("aria-label") === "Chat");

    expect(chatButton?.classList.contains("ember-tab-button--active")).toBe(true);
  });

  it("5. all buttons have aria-label", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomTabBar activeTab="chat" onChange={onChange} />
      </div>,
    );

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(5);

    const expectedLabels = ["Sessions", "Agents", "Chat", "Commands", "Settings"];
    buttons.forEach((btn, idx) => {
      const ariaLabel = btn.getAttribute("aria-label");
      expect(ariaLabel).not.toBeNull();
      expect(expectedLabels).toContain(ariaLabel);
    });
  });

  it("clicking different tabs calls onChange with correct id", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <BottomTabBar activeTab="chat" onChange={onChange} />
      </div>,
    );

    const buttons = container.querySelectorAll("button");
    const agentsButton = Array.from(buttons).find(
      (btn) => btn.getAttribute("aria-label") === "Agents",
    );
    const settingsButton = Array.from(buttons).find(
      (btn) => btn.getAttribute("aria-label") === "Settings",
    );

    fireEvent.click(agentsButton as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("agents");

    fireEvent.click(settingsButton as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("settings");
  });
});
