import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import QuestionStepper from "./QuestionStepper";

describe("QuestionStepper", () => {
  afterEach(() => {
    cleanup();
  });

  it("currentIndex=0, total=3 shows 1/3, Previous disabled, Next enabled", () => {
    const { getByText, container } = render(
      <QuestionStepper
        total={3}
        currentIndex={0}
        onNext={mock(() => {})}
        onPrevious={mock(() => {})}
      >
        <div>Question content</div>
      </QuestionStepper>,
    );

    expect(getByText("1 / 3")).not.toBeNull();
    const buttons = container.querySelectorAll(".stepper-btn");
    expect(buttons.length).toBe(2);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it("currentIndex=1, total=3 shows 2/3, both buttons enabled", () => {
    const { getByText, container } = render(
      <QuestionStepper
        total={3}
        currentIndex={1}
        onNext={mock(() => {})}
        onPrevious={mock(() => {})}
      >
        <div>Question content</div>
      </QuestionStepper>,
    );

    expect(getByText("2 / 3")).not.toBeNull();
    const buttons = container.querySelectorAll(".stepper-btn");
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it("currentIndex=2, total=3 shows 3/3, Next disabled, Previous enabled", () => {
    const { getByText, container } = render(
      <QuestionStepper
        total={3}
        currentIndex={2}
        onNext={mock(() => {})}
        onPrevious={mock(() => {})}
      >
        <div>Question content</div>
      </QuestionStepper>,
    );

    expect(getByText("3 / 3")).not.toBeNull();
    const buttons = container.querySelectorAll(".stepper-btn");
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("total=1 renders no stepper controls at all", () => {
    const { container, queryByText } = render(
      <QuestionStepper
        total={1}
        currentIndex={0}
        onNext={mock(() => {})}
        onPrevious={mock(() => {})}
      >
        <div>Question content</div>
      </QuestionStepper>,
    );

    expect(queryByText("1 / 1")).toBeNull();
    expect(container.querySelector(".stepper-controls")).toBeNull();
  });

  it("click Next calls onNext", () => {
    const onNext = mock(() => {});
    const { getByText } = render(
      <QuestionStepper total={3} currentIndex={1} onNext={onNext} onPrevious={mock(() => {})}>
        <div>Question content</div>
      </QuestionStepper>,
    );

    fireEvent.click(getByText("Next"));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("click Previous calls onPrevious", () => {
    const onPrevious = mock(() => {});
    const { getByText } = render(
      <QuestionStepper total={3} currentIndex={1} onNext={mock(() => {})} onPrevious={onPrevious}>
        <div>Question content</div>
      </QuestionStepper>,
    );

    fireEvent.click(getByText("Previous"));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });
});
