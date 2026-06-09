import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import CompactDivider from "../components/linear/CompactDivider";

describe("CompactDivider", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders pre/post token figures when both provided", () => {
    render(<CompactDivider preTokens={24000} postTokens={8000} />);
    const label = screen.getByLabelText("History compacted");
    expect(label).toBeDefined();
    expect(label.textContent).toContain("24k");
    expect(label.textContent).toContain("8k");
    expect(label.textContent?.toLowerCase()).toContain("history compacted");
  });

  test("renders only generic label when preTokens is undefined", () => {
    render(<CompactDivider />);
    const label = screen.getByLabelText("History compacted");
    expect(label).toBeDefined();
    expect(label.textContent?.toLowerCase()).toContain("history compacted");
    // No token figures
    expect(label.textContent).not.toContain("k →");
    expect(label.textContent).not.toMatch(/\d/);
  });

  test("renders preTokens only when postTokens missing", () => {
    render(<CompactDivider preTokens={12000} />);
    const label = screen.getByLabelText("History compacted");
    expect(label.textContent).toContain("12k");
    expect(label.textContent).not.toContain("→");
  });
});
