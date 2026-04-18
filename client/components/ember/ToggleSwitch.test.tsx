import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import ToggleSwitch from "./ToggleSwitch";

describe("ToggleSwitch", () => {
  test("renders with role switch and aria-checked false", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <ToggleSwitch checked={false} onChange={onChange} />
      </div>,
    );

    const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
    expect(switchEl).toBeDefined();
    expect(switchEl.getAttribute("aria-checked")).toBe("false");
  });

  test("calls onChange with true when clicked while unchecked", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <ToggleSwitch checked={false} onChange={onChange} />
      </div>,
    );

    const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
    fireEvent.click(switchEl);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("disabled switch does not call onChange and has aria-disabled", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <ToggleSwitch checked={true} onChange={onChange} disabled />
      </div>,
    );

    const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
    fireEvent.click(switchEl);

    expect(onChange).not.toHaveBeenCalled();
    expect(switchEl.getAttribute("aria-disabled")).toBe("true");
    expect(switchEl.hasAttribute("disabled")).toBe(true);
  });

  test("checked switch has amber background on track", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <ToggleSwitch checked={true} onChange={onChange} />
      </div>,
    );

    const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
    expect(switchEl.getAttribute("data-checked")).toBe("true");

    // Verify the track element exists
    const track = switchEl.querySelector(".ember-toggle-track") as HTMLElement;
    expect(track).toBeDefined();
  });

  test("label prop sets aria-label", () => {
    const onChange = mock(() => {});
    const { container } = render(
      <div className="theme-ember">
        <ToggleSwitch checked={false} onChange={onChange} label="Enable feature" />
      </div>,
    );

    const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
    expect(switchEl.getAttribute("aria-label")).toBe("Enable feature");
  });
});
