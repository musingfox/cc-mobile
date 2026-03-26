import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import PreviewRenderer from "./PreviewRenderer";

describe("PreviewRenderer", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders sanitized HTML with bold tag present", () => {
    const { container } = render(<PreviewRenderer html="<p>Hello <b>world</b></p>" />);
    const bold = container.querySelector("b");
    expect(bold).not.toBeNull();
    expect(bold?.textContent).toBe("world");
  });

  it("script removed, safe text visible", () => {
    const { container, getByText } = render(
      <PreviewRenderer html="<script>alert('xss')</script><p>Safe text</p>" />,
    );
    const script = container.querySelector("script");
    expect(script).toBeNull();
    expect(getByText("Safe text")).not.toBeNull();
  });

  it("onerror attribute removed", () => {
    const { container } = render(<PreviewRenderer html="<img src=x onerror=alert(1)>" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("onerror")).toBeNull();
  });

  it("empty string renders preview unavailable", () => {
    const { getByText } = render(<PreviewRenderer html="" />);
    expect(getByText("(Preview unavailable)")).not.toBeNull();
  });
});
