import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import OptionButton from "./OptionButton";

describe("OptionButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders label and description as settings-row", () => {
    const option = {
      label: "Python",
      description: "Python description",
    };
    const { container, getByText } = render(
      <OptionButton option={option} onSelect={mock(() => {})} />,
    );

    expect(getByText("Python")).not.toBeNull();
    expect(getByText("Python description")).not.toBeNull();
    expect(container.querySelector(".lin-settings-row")).not.toBeNull();
  });

  it("shows preview toggle when preview exists; toggling expands the panel", () => {
    const option = {
      label: "Python",
      description: "Python description",
      preview: "# Hello\n\nworld",
    };
    const { container } = render(<OptionButton option={option} onSelect={mock(() => {})} />);

    const toggle = container.querySelector(".preview-toggle") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(container.querySelector(".preview-panel")).toBeNull();

    fireEvent.click(toggle);
    expect(container.querySelector(".preview-panel")).not.toBeNull();

    fireEvent.click(toggle);
    expect(container.querySelector(".preview-panel")).toBeNull();
  });

  it("does not render toggle when preview is missing or empty", () => {
    const { container, rerender } = render(
      <OptionButton option={{ label: "Python", description: "" }} onSelect={mock(() => {})} />,
    );
    expect(container.querySelector(".preview-toggle")).toBeNull();

    rerender(
      <OptionButton
        option={{ label: "Python", description: "", preview: "   " }}
        onSelect={mock(() => {})}
      />,
    );
    expect(container.querySelector(".preview-toggle")).toBeNull();
  });

  it("renders checkbox when multiSelect is true; reflects selected state", () => {
    const { container, rerender } = render(
      <OptionButton
        option={{ label: "Python", description: "" }}
        multiSelect
        selected={false}
        onSelect={mock(() => {})}
      />,
    );
    const box = container.querySelector(".option-checkbox");
    expect(box).not.toBeNull();
    expect(box?.classList.contains("is-checked")).toBe(false);

    rerender(
      <OptionButton
        option={{ label: "Python", description: "" }}
        multiSelect
        selected
        onSelect={mock(() => {})}
      />,
    );
    expect(container.querySelector(".option-checkbox.is-checked")).not.toBeNull();
    expect(container.querySelector(".option-button-container.is-selected")).not.toBeNull();
  });

  it("clicking button calls onSelect", () => {
    const option = {
      label: "Python",
      description: "Python description",
    };
    const onSelect = mock(() => {});
    const { getByText } = render(<OptionButton option={option} onSelect={onSelect} />);

    fireEvent.click(getByText("Python"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
