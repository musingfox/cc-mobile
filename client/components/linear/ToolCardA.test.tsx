import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import ToolCardA from "./ToolCardA";

describe("ToolCardA — agent attribution chip", () => {
  afterEach(() => {
    cleanup();
  });

  test("no agent props → no chip row rendered", () => {
    const { container } = render(<ToolCardA toolName="Read" input={{}} result="x" />);
    expect(container.querySelector(".lin-tool-card-agent")).toBeNull();
  });

  test("both agent props present → chip renders with label and description", () => {
    const { container } = render(
      <ToolCardA
        toolName="Read"
        input={{}}
        result="x"
        agentLabel="explore"
        agentDescription="investigate bug"
      />,
    );
    const chip = container.querySelector(".lin-tool-card-agent");
    expect(chip).not.toBeNull();
    const label = chip?.querySelector(".lin-tool-card-agent-label")?.textContent ?? "";
    const desc = chip?.querySelector(".lin-tool-card-agent-desc")?.textContent ?? "";
    expect(label.toLowerCase()).toContain("explore");
    expect(desc).toContain("investigate bug");
  });

  test("empty agentLabel → no chip rendered (treated as missing)", () => {
    const { container } = render(
      <ToolCardA
        toolName="Read"
        input={{}}
        result="x"
        agentLabel=""
        agentDescription="investigate bug"
      />,
    );
    expect(container.querySelector(".lin-tool-card-agent")).toBeNull();
  });
});

describe("ToolCardA — diffstat summary", () => {
  afterEach(() => {
    cleanup();
  });

  test("Edit tool with diff → header shows +N -N counts collapsed", () => {
    const { container } = render(
      <ToolCardA
        toolName="Edit"
        input={{ old_string: "a\nb\nc", new_string: "a\nx\ny\nc" }}
        result="ok"
      />,
    );
    const stat = container.querySelector(".lin-tool-diffstat");
    expect(stat).not.toBeNull();
    expect(stat?.querySelector(".lin-diffstat-add")?.textContent).toBe("+2");
    expect(stat?.querySelector(".lin-diffstat-remove")?.textContent).toBe("-1");
    // Collapsed: no expanded diff body
    expect(container.querySelector(".lin-tool-diff")).toBeNull();
  });

  test("non-diff tool → no diffstat rendered", () => {
    const { container } = render(<ToolCardA toolName="Bash" input={{ command: "ls" }} result="" />);
    expect(container.querySelector(".lin-tool-diffstat")).toBeNull();
  });
});
