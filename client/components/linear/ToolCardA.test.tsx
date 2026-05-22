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
