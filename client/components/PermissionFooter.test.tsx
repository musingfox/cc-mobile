import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import PermissionFooter from "./PermissionFooter";

describe("PermissionFooter", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders tool info and 3 action buttons", () => {
    const onRespond = mock(() => {});
    const { container, getByText } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    // Tool info displayed
    expect(getByText("Edit")).not.toBeNull();
    expect(getByText("test.ts")).not.toBeNull();

    // 3 action buttons
    const buttons = container.querySelectorAll(".permission-btn");
    expect(buttons).toHaveLength(3);
  });

  it("clicking Yes calls onRespond with approve", () => {
    const onRespond = mock(() => {});
    const { getByText } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(getByText("Yes"));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith("approve");
  });

  it("clicking No calls onRespond with deny", () => {
    const onRespond = mock(() => {});
    const { getByText } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(getByText("No"));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith("deny");
  });

  it("clicking Allow in this session calls onRespond with approve_session", () => {
    const onRespond = mock(() => {});
    const { getByText } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(getByText("Allow in this session"));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith("approve_session");
  });

  it("buttons have semantic color classes", () => {
    const onRespond = mock(() => {});
    const { container } = render(
      <PermissionFooter toolName="Bash" parameters={{ command: "ls" }} onRespond={onRespond} />,
    );

    const buttons = container.querySelectorAll(".permission-btn");
    expect(buttons[0].classList.contains("green")).toBe(true);
    expect(buttons[1].classList.contains("blue")).toBe(true);
    expect(buttons[2].classList.contains("red")).toBe(true);
  });

  it("shows Bash command in params", () => {
    const onRespond = mock(() => {});
    const { getByText } = render(
      <PermissionFooter toolName="Bash" parameters={{ command: "ls -la" }} onRespond={onRespond} />,
    );

    expect(getByText("Bash")).not.toBeNull();
    expect(getByText("ls -la")).not.toBeNull();
  });

  it("selected button gets selected class", () => {
    const onRespond = mock(() => {});
    const { container, getByText } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(getByText("Yes"));
    const buttons = container.querySelectorAll(".permission-btn");
    expect(buttons[0].classList.contains("selected")).toBe(true);
    expect(buttons[1].classList.contains("unselected")).toBe(true);
    expect(buttons[2].classList.contains("unselected")).toBe(true);
  });

  it("AskUserQuestion with valid questions renders AskUserQuestionUI", () => {
    const onAnswer = mock(() => {});
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
    const { getByText } = render(
      <PermissionFooter
        toolName="AskUserQuestion"
        parameters={{ questions }}
        onRespond={mock(() => {})}
        onAnswer={onAnswer}
      />,
    );

    expect(getByText("Which language?")).not.toBeNull();
  });

  it("AskUserQuestion with empty/missing questions renders fallback", () => {
    const onAnswer = mock(() => {});
    const { container } = render(
      <PermissionFooter
        toolName="AskUserQuestion"
        parameters={{}}
        onRespond={mock(() => {})}
        onAnswer={onAnswer}
      />,
    );

    // Should render default permission UI when no questions
    expect(container.querySelector(".permission-tool-name")?.textContent).toBe("AskUserQuestion");
  });

  it("answer submitted calls onAnswer with answers map", () => {
    const onAnswer = mock(() => {});
    const questions = [
      {
        question: "Which language?",
        header: "Language",
        options: [{ label: "Python", description: "Python desc" }],
      },
    ];
    const { getByText } = render(
      <PermissionFooter
        toolName="AskUserQuestion"
        parameters={{ questions }}
        onRespond={mock(() => {})}
        onAnswer={onAnswer}
      />,
    );

    fireEvent.click(getByText("Python"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ "Which language?": "Python" });
  });
});
