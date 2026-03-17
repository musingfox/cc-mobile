import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import DrawerBase from "../components/drawers/DrawerBase";

describe("DrawerBase", () => {
  afterEach(() => {
    cleanup();
  });
  test("renders children when open=true", () => {
    render(
      <DrawerBase open={true} onOpenChange={() => {}}>
        <div>Test Content</div>
      </DrawerBase>,
    );
    expect(screen.getByText("Test Content")).toBeDefined();
  });

  test("renders title when provided", () => {
    render(
      <DrawerBase open={true} onOpenChange={() => {}} title="Test Title">
        <div>Content</div>
      </DrawerBase>,
    );
    expect(screen.getByText("Test Title")).toBeDefined();
  });

  test("does not render content when open=false", () => {
    const { container } = render(
      <DrawerBase open={false} onOpenChange={() => {}}>
        <div>Hidden Content</div>
      </DrawerBase>,
    );
    // When closed, Vaul doesn't render the content in the DOM
    expect(container.querySelector("[data-vaul-drawer]")).toBeNull();
  });
});
