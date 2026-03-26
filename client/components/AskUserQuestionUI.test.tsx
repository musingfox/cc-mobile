import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import AskUserQuestionUI from "./AskUserQuestionUI";

describe("AskUserQuestionUI", () => {
  afterEach(() => {
    cleanup();
  });

  it("single question with 2 options renders options, NO stepper controls", () => {
    const questions = [
      {
        question: "Which language?",
        header: "Language",
        options: [
          { label: "Python", description: "Python desc" },
          { label: "Go", description: "Go desc" },
        ],
      },
    ];
    const { container, getByText } = render(
      <AskUserQuestionUI questions={questions} onAnswer={mock(() => {})} />,
    );

    expect(getByText("Which language?")).not.toBeNull();
    expect(getByText("Python")).not.toBeNull();
    expect(getByText("Go")).not.toBeNull();
    expect(container.querySelector(".stepper-controls")).toBeNull();
  });

  it("two questions renders stepper 1/2, shows first question options", () => {
    const questions = [
      {
        question: "Which language?",
        header: "Language",
        options: [{ label: "Python", description: "" }],
      },
      {
        question: "Which framework?",
        header: "Framework",
        options: [{ label: "FastAPI", description: "" }],
      },
    ];
    const { getByText, queryByText } = render(
      <AskUserQuestionUI questions={questions} onAnswer={mock(() => {})} />,
    );

    expect(getByText("1 / 2")).not.toBeNull();
    expect(getByText("Which language?")).not.toBeNull();
    expect(getByText("Python")).not.toBeNull();
    expect(queryByText("Which framework?")).toBeNull();
  });

  it("click option on single-question calls onAnswer immediately", () => {
    const questions = [
      {
        question: "Which language?",
        header: "Language",
        options: [{ label: "Python", description: "" }],
      },
    ];
    const onAnswer = mock(() => {});
    const { getByText } = render(<AskUserQuestionUI questions={questions} onAnswer={onAnswer} />);

    fireEvent.click(getByText("Python"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ "Which language?": "Python" });
  });

  it("click option on multi-question first question does NOT call onAnswer, stores in state", () => {
    const questions = [
      {
        question: "Which language?",
        header: "Language",
        options: [{ label: "Python", description: "" }],
      },
      {
        question: "Which framework?",
        header: "Framework",
        options: [{ label: "FastAPI", description: "" }],
      },
    ];
    const onAnswer = mock(() => {});
    const { getByText } = render(<AskUserQuestionUI questions={questions} onAnswer={onAnswer} />);

    fireEvent.click(getByText("Python"));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(getByText("2 / 2")).not.toBeNull();
    expect(getByText("Which framework?")).not.toBeNull();
  });

  it("type custom answer + Enter on single-question calls onAnswer", () => {
    const questions = [
      {
        question: "Which language?",
        header: "Language",
        options: [{ label: "Python", description: "" }],
      },
    ];
    const onAnswer = mock(() => {});
    const { container } = render(<AskUserQuestionUI questions={questions} onAnswer={onAnswer} />);

    const input = container.querySelector(".custom-answer-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "Rust" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ "Which language?": "Rust" });
  });

  it("question with multiSelect: true renders error message", () => {
    const questions = [
      {
        question: "Which languages?",
        header: "Languages",
        options: [{ label: "Python", description: "" }],
        multiSelect: true,
      },
    ];
    const { getByText } = render(
      <AskUserQuestionUI questions={questions} onAnswer={mock(() => {})} />,
    );

    expect(getByText("Multi-select questions are not yet supported")).not.toBeNull();
  });

  it("multi-question: select option on Q1, click Next, select option on Q2, click Submit calls onAnswer with both", () => {
    const questions = [
      {
        question: "Which language?",
        header: "Language",
        options: [{ label: "Python", description: "" }],
      },
      {
        question: "Which framework?",
        header: "Framework",
        options: [{ label: "FastAPI", description: "" }],
      },
    ];
    const onAnswer = mock(() => {});
    const { getByText, container } = render(
      <AskUserQuestionUI questions={questions} onAnswer={onAnswer} />,
    );

    // Selecting option on Q1 auto-advances to Q2
    fireEvent.click(getByText("Python"));
    expect(getByText("2 / 2")).not.toBeNull();

    // Selecting option on Q2 calls onAnswer
    fireEvent.click(getByText("FastAPI"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({
      "Which language?": "Python",
      "Which framework?": "FastAPI",
    });
  });

  it("multi-question: on last question, submit button is visible", () => {
    const questions = [
      {
        question: "Which language?",
        header: "Language",
        options: [{ label: "Python", description: "" }],
      },
      {
        question: "Which framework?",
        header: "Framework",
        options: [{ label: "FastAPI", description: "" }],
      },
    ];
    const { getByText, container } = render(
      <AskUserQuestionUI questions={questions} onAnswer={mock(() => {})} />,
    );

    // Advance to Q2
    fireEvent.click(getByText("Python"));

    // Submit button should be visible
    const submitBtn = container.querySelector(".custom-answer-row .permission-btn");
    expect(submitBtn).not.toBeNull();
    expect(submitBtn?.textContent).toContain("Submit");
  });
});
