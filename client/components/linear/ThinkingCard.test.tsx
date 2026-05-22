import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ThinkingCard } from "./ChatScreen";

describe("ThinkingCard", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders thinking variant", () => {
    const { container, getByText } = render(<ThinkingCard kind="thinking" />);
    const card = container.querySelector(".lin-thinking");

    expect(card).not.toBeNull();
    expect(card?.classList.contains("lin-thinking--streaming")).toBe(false);
    expect(card?.classList.contains("lin-thinking--waiting")).toBe(false);
    expect(getByText("Thinking")).not.toBeNull();
  });

  test("renders streaming variant", () => {
    const { container, getByText } = render(<ThinkingCard kind="streaming" />);
    const card = container.querySelector(".lin-thinking");

    expect(card?.classList.contains("lin-thinking--streaming")).toBe(true);
    expect(getByText("Streaming")).not.toBeNull();
  });

  test("renders waiting-permission variant", () => {
    const { container, getByText } = render(<ThinkingCard kind="waiting-permission" />);
    const card = container.querySelector(".lin-thinking");

    expect(card?.classList.contains("lin-thinking--waiting")).toBe(true);
    expect(getByText("Waiting for permission")).not.toBeNull();
  });

  test("defaults to thinking variant", () => {
    const { getByText } = render(<ThinkingCard />);
    expect(getByText("Thinking")).not.toBeNull();
  });
});
