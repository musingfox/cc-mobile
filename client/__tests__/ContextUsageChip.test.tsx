import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import ContextUsageChip from "../components/linear/ContextUsageChip";

describe("ContextUsageChip", () => {
  afterEach(() => {
    cleanup();
  });

  test("shows formatted '8.2k / 200k' for moderate usage", () => {
    render(
      <ContextUsageChip
        contextUsage={{ totalTokens: 8200, maxTokens: 200_000, percentage: 0.041 }}
      />,
    );
    const chip = screen.getByLabelText("Context usage");
    expect(chip.textContent).toContain("8.2k");
    expect(chip.textContent).toContain("200k");
    expect(chip.className).not.toContain("is-warning");
  });

  test("adds warning class when percentage >= 0.8", () => {
    render(
      <ContextUsageChip
        contextUsage={{ totalTokens: 170_000, maxTokens: 200_000, percentage: 0.85 }}
      />,
    );
    const chip = screen.getByLabelText("Context usage");
    expect(chip.className).toContain("is-warning");
  });

  test("renders skeleton '— / —' when contextUsage is null", () => {
    render(<ContextUsageChip contextUsage={null} />);
    const chip = screen.getByLabelText("Context usage unavailable");
    expect(chip.textContent).toContain("—");
    expect(chip.className).toContain("is-loading");
  });
});
