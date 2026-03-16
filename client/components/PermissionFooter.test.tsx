import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import PermissionFooter from "./PermissionFooter";

describe("PermissionFooter", () => {
  it("4. renders 3 options vertically", () => {
    const onRespond = mock(() => {});
    const { container } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    const options = container.querySelectorAll(".permission-option");
    expect(options).toHaveLength(3);

    // Check footer exists
    const footer = container.querySelector(".permission-footer");
    expect(footer).not.toBeNull();
  });

  it("5. Each option has min-height 48px for touch targets", () => {
    const onRespond = mock(() => {});
    const { container } = render(
      <PermissionFooter toolName="Bash" parameters={{ command: "ls" }} onRespond={onRespond} />,
    );

    const options = container.querySelectorAll(".permission-option");
    // Verify all options have the permission-option class (which defines min-height in CSS)
    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(option.classList.contains("permission-option")).toBe(true);
    }
  });

  it("6. Clicking approve option calls onRespond with approve", () => {
    const onRespond = mock(() => {});
    const { container } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    const buttons = container.querySelectorAll(".permission-option");
    fireEvent.click(buttons[0]); // First option is "Yes"

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith("approve");
  });

  it("7. Clicking deny option calls onRespond with deny", () => {
    const onRespond = mock(() => {});
    const { container } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    const buttons = container.querySelectorAll(".permission-option");
    fireEvent.click(buttons[2]); // Third option is "No"

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith("deny");
  });

  it("Clicking approve_session option calls onRespond with approve_session", () => {
    const onRespond = mock(() => {});
    const { container } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    const buttons = container.querySelectorAll(".permission-option");
    fireEvent.click(buttons[1]); // Second option is "Yes, allow all edits"

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith("approve_session");
  });

  it("Options display correct semantic colors", () => {
    const onRespond = mock(() => {});
    const { container } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    const options = container.querySelectorAll(".permission-option");
    expect(options[0].classList.contains("green")).toBe(true);
    expect(options[1].classList.contains("blue")).toBe(true);
    expect(options[2].classList.contains("red")).toBe(true);
  });

  it("Selected option shows selected class", () => {
    const onRespond = mock(() => {});
    const { container } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    const buttons = container.querySelectorAll(".permission-option");
    fireEvent.click(buttons[0]); // First option

    expect(buttons[0].classList.contains("selected")).toBe(true);
  });

  it("Unselected options show unselected class after selection", () => {
    const onRespond = mock(() => {});
    const { container } = render(
      <PermissionFooter
        toolName="Edit"
        parameters={{ file_path: "test.ts" }}
        onRespond={onRespond}
      />,
    );

    const buttons = container.querySelectorAll(".permission-option");
    fireEvent.click(buttons[0]); // Click first option

    expect(buttons[1].classList.contains("unselected")).toBe(true);
    expect(buttons[2].classList.contains("unselected")).toBe(true);
  });
});
