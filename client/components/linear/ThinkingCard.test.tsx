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
    expect(card?.classList.contains("lin-thinking--waiting")).toBe(false);
    expect(getByText("Thinking")).not.toBeNull();
  });

  test("renders waiting-permission variant", () => {
    const { container, getByText } = render(<ThinkingCard kind="waiting-permission" />);
    const card = container.querySelector(".lin-thinking");

    expect(card?.classList.contains("lin-thinking--waiting")).toBe(true);
    expect(getByText("Waiting for permission")).not.toBeNull();
  });

  test("renders waiting-answer variant with the same waiting treatment", () => {
    // A question is the terminal waiting on this phone too, so it keeps the
    // modifier; only the words change, because nobody is granting permission.
    const { container, getByText } = render(<ThinkingCard kind="waiting-answer" />);
    const card = container.querySelector(".lin-thinking");

    expect(card?.classList.contains("lin-thinking--waiting")).toBe(true);
    expect(getByText("Waiting for your answer")).not.toBeNull();
  });

  test("defaults to thinking variant", () => {
    const { getByText } = render(<ThinkingCard />);
    expect(getByText("Thinking")).not.toBeNull();
  });
});
