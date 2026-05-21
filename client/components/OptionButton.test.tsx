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

  it("does not render preview panel or toggle even when preview exists", () => {
    const option = {
      label: "Python",
      description: "Python description",
      preview: "<p>Preview</p>",
    };
    const { container } = render(<OptionButton option={option} onSelect={mock(() => {})} />);

    expect(container.querySelector(".preview-toggle")).toBeNull();
    expect(container.querySelector(".preview-panel")).toBeNull();
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
