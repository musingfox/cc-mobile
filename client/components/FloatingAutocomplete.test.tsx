import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import FloatingAutocomplete from "./FloatingAutocomplete";

describe("FloatingAutocomplete", () => {
  afterEach(() => {
    cleanup();
  });
  test("renders suggestions when visible", () => {
    const suggestions = [
      { label: "/search", type: "command" as const },
      { label: "/edit", type: "command" as const },
    ];
    const onSelect = mock(() => {});

    const { container } = render(
      <FloatingAutocomplete
        suggestions={suggestions}
        selectedIndex={0}
        onSelect={onSelect}
        visible={true}
      />,
    );

    expect(container.querySelector(".floating-autocomplete")).not.toBeNull();
    expect(container.textContent).toContain("/search");
    expect(container.textContent).toContain("/edit");
  });

  test("renders nothing when not visible", () => {
    const suggestions = [{ label: "/search", type: "command" as const }];
    const onSelect = mock(() => {});

    const { container } = render(
      <FloatingAutocomplete
        suggestions={suggestions}
        selectedIndex={0}
        onSelect={onSelect}
        visible={false}
      />,
    );

    expect(container.querySelector(".floating-autocomplete")).toBeNull();
  });

  test("renders nothing when suggestions empty", () => {
    const onSelect = mock(() => {});

    const { container } = render(
      <FloatingAutocomplete
        suggestions={[]}
        selectedIndex={0}
        onSelect={onSelect}
        visible={true}
      />,
    );

    expect(container.querySelector(".floating-autocomplete")).toBeNull();
  });

  test("highlights selected item", () => {
    const suggestions = [
      { label: "/search", type: "command" as const },
      { label: "/edit", type: "command" as const },
    ];
    const onSelect = mock(() => {});

    const { container } = render(
      <FloatingAutocomplete
        suggestions={suggestions}
        selectedIndex={1}
        onSelect={onSelect}
        visible={true}
      />,
    );

    const items = container.querySelectorAll(".floating-autocomplete-item");
    expect(items[0].classList.contains("selected")).toBe(false);
    expect(items[1].classList.contains("selected")).toBe(true);
  });

  test("shows description when available", () => {
    const suggestions = [
      { label: "/search", description: "Search files", type: "command" as const },
    ];
    const onSelect = mock(() => {});

    const { container } = render(
      <FloatingAutocomplete
        suggestions={suggestions}
        selectedIndex={0}
        onSelect={onSelect}
        visible={true}
      />,
    );

    expect(container.textContent).toContain("Search files");
  });

  test("calls onSelect when item clicked", () => {
    const suggestions = [{ label: "/search", type: "command" as const }];
    const onSelect = mock(() => {});

    const { container } = render(
      <FloatingAutocomplete
        suggestions={suggestions}
        selectedIndex={0}
        onSelect={onSelect}
        visible={true}
      />,
    );

    const item = container.querySelector(".floating-autocomplete-item");
    expect(item).not.toBeNull();
    fireEvent.click(item as Element);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("/search");
  });
});
