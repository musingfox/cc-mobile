import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import AnimatedMessage from "../components/animated/AnimatedMessage";

describe("AnimatedMessage", () => {
  afterEach(() => {
    cleanup();
  });
  test("renders children", () => {
    const { container } = render(
      <AnimatedMessage index={0}>
        <div>Test Content</div>
      </AnimatedMessage>,
    );

    expect(container.textContent).toContain("Test Content");
  });

  test("wraps in a div (motion.div renders as div)", () => {
    const { container } = render(
      <AnimatedMessage index={0}>
        <span>Child</span>
      </AnimatedMessage>,
    );

    const wrapper = container.firstChild;
    expect(wrapper?.nodeName).toBe("DIV");
  });

  test("accepts different index values", () => {
    const { container } = render(
      <>
        <AnimatedMessage index={0}>
          <div>Message 0</div>
        </AnimatedMessage>
        <AnimatedMessage index={5}>
          <div>Message 5</div>
        </AnimatedMessage>
      </>,
    );

    expect(container.textContent).toContain("Message 0");
    expect(container.textContent).toContain("Message 5");
  });
});
