import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import OptionButton from "./OptionButton";

describe("OptionButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("option with preview, expanded=false shows button, no preview panel", () => {
    const option = {
      label: "Python",
      description: "Python description",
      preview: "<p>Preview content</p>",
    };
    const { container, getByText, queryByText } = render(
      <OptionButton
        option={option}
        expanded={false}
        onTogglePreview={mock(() => {})}
        onSelect={mock(() => {})}
      />,
    );

    expect(getByText("Python")).not.toBeNull();
    expect(container.querySelector(".preview-panel")).toBeNull();
    expect(queryByText("Preview content")).toBeNull();
  });

  it("option with preview, expanded=true shows preview panel with sanitized HTML", () => {
    const option = {
      label: "Python",
      description: "Python description",
      preview: "<p>Preview <b>content</b></p>",
    };
    const { container, getByText } = render(
      <OptionButton
        option={option}
        expanded={true}
        onTogglePreview={mock(() => {})}
        onSelect={mock(() => {})}
      />,
    );

    expect(getByText("Python")).not.toBeNull();
    expect(container.querySelector(".preview-panel")).not.toBeNull();
    expect(getByText("content")).not.toBeNull();
    expect(container.querySelector("b")).not.toBeNull();
  });

  it("option without preview renders no toggle button", () => {
    const option = {
      label: "Python",
      description: "Python description",
    };
    const { container } = render(
      <OptionButton
        option={option}
        expanded={false}
        onTogglePreview={mock(() => {})}
        onSelect={mock(() => {})}
      />,
    );

    expect(container.querySelector(".preview-toggle")).toBeNull();
  });

  it("click preview toggle calls onTogglePreview", () => {
    const option = {
      label: "Python",
      description: "Python description",
      preview: "<p>Preview</p>",
    };
    const onTogglePreview = mock(() => {});
    const { container } = render(
      <OptionButton
        option={option}
        expanded={false}
        onTogglePreview={onTogglePreview}
        onSelect={mock(() => {})}
      />,
    );

    const toggleBtn = container.querySelector(".preview-toggle");
    expect(toggleBtn).not.toBeNull();
    if (toggleBtn) {
      fireEvent.click(toggleBtn);
      expect(onTogglePreview).toHaveBeenCalledTimes(1);
    }
  });

  it("click main button area calls onSelect", () => {
    const option = {
      label: "Python",
      description: "Python description",
      preview: "<p>Preview</p>",
    };
    const onSelect = mock(() => {});
    const { getByText } = render(
      <OptionButton
        option={option}
        expanded={false}
        onTogglePreview={mock(() => {})}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(getByText("Python"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
